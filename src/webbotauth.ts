/**
 * Web Bot Auth: an agent signs each request with HTTP Message Signatures (RFC 9421) using Ed25519, and publishes its
 * public keys in a key directory at <signature-agent>/.well-known/http-message-signatures-directory.
 *
 * The gateway rebuilds the signature base from the request, finds the key by its JWK thumbprint (RFC 7638), and
 * checks the signature, the time window and the tag. A request with no signature is "unverified"; a request with a
 * signature that does not verify is refused, never downgraded to unverified.
 */

export type BotIdentity =
  | { kind: "verified"; operator: string; keyid: string; agent: string }
  | { kind: "unverified" }
  | { kind: "invalid"; reason: string };

export interface Jwk {
  kty: string;
  crv: string;
  x: string;
}

export interface DirectoryResolver {
  keys(signatureAgent: string): Promise<Jwk[]>;
}

export interface VerifyOptions {
  now: number; // seconds
  maxValiditySeconds: number;
  clockSkewSeconds: number;
}

const enc = new TextEncoder();

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function bytesToB64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** RFC 7638 thumbprint of an OKP key: SHA-256 over {"crv","kty","x"} in that order, base64url. */
export async function thumbprint(jwk: Jwk): Promise<string> {
  const canonical = `{"crv":${JSON.stringify(jwk.crv)},"kty":${JSON.stringify(jwk.kty)},"x":${JSON.stringify(jwk.x)}}`;
  const h = await crypto.subtle.digest("SHA-256", enc.encode(canonical));
  return bytesToB64url(new Uint8Array(h));
}

interface ParsedInput {
  label: string;
  components: string[];
  params: Record<string, string | number>;
  serialized: string; // the inner list exactly as sent, used as @signature-params
}

/** The subset of RFC 8941 structured fields that Signature-Input uses: label=("c1" "c2");k=v;k="v". */
export function parseSignatureInput(header: string): ParsedInput[] {
  const out: ParsedInput[] = [];
  for (const member of splitTopLevel(header)) {
    const eq = member.indexOf("=");
    if (eq < 1) throw new Error("bad Signature-Input member");
    const label = member.slice(0, eq).trim();
    const serialized = member.slice(eq + 1).trim();
    const m = /^\(([^)]*)\)(.*)$/.exec(serialized);
    if (!m) throw new Error("Signature-Input must be an inner list");
    const components = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    const params: Record<string, string | number> = {};
    for (const p of m[2].split(";").filter(Boolean)) {
      const [k, ...rest] = p.split("=");
      const v = rest.join("=");
      if (/^"[^"]*"$/.test(v)) params[k.trim()] = v.slice(1, -1);
      else if (/^-?\d+$/.test(v)) params[k.trim()] = Number(v);
      else throw new Error(`unsupported parameter value for ${k}`);
    }
    out.push({ label, components, params, serialized });
  }
  return out;
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function parseSignature(header: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const member of splitTopLevel(header)) {
    const m = /^([a-zA-Z0-9_-]+)=:([A-Za-z0-9+/=]+):$/.exec(member);
    if (!m) throw new Error("bad Signature member");
    out.set(m[1], b64ToBytes(m[2]));
  }
  return out;
}

/** RFC 9421 section 2.5: one line per component, then @signature-params. */
export function signatureBase(req: Request, input: ParsedInput): string {
  const url = new URL(req.url);
  const lines: string[] = [];
  for (const c of input.components) {
    let value: string | null;
    if (c === "@authority") value = url.host.toLowerCase();
    else if (c === "@path") value = url.pathname;
    else if (c === "@method") value = req.method.toUpperCase();
    else if (c.startsWith("@")) throw new Error(`unsupported derived component ${c}`);
    else value = req.headers.get(c);
    if (value === null) throw new Error(`signed component ${c} is missing`);
    lines.push(`"${c}": ${value.trim()}`);
  }
  lines.push(`"@signature-params": ${input.serialized}`);
  return lines.join("\n");
}

export async function verifyRequest(
  req: Request,
  resolver: DirectoryResolver,
  opts: VerifyOptions,
): Promise<BotIdentity> {
  const sigInput = req.headers.get("signature-input");
  const sig = req.headers.get("signature");
  const agentHeader = req.headers.get("signature-agent");
  if (!sigInput && !sig) return { kind: "unverified" };
  if (!sigInput || !sig || !agentHeader) return { kind: "invalid", reason: "incomplete signature headers" };
  let inputs: ParsedInput[];
  let sigs: Map<string, Uint8Array>;
  try {
    inputs = parseSignatureInput(sigInput);
    sigs = parseSignature(sig);
  } catch (e) {
    return { kind: "invalid", reason: (e as Error).message };
  }
  const input = inputs.find((i) => i.params.tag === "web-bot-auth");
  if (!input) return { kind: "invalid", reason: "no web-bot-auth signature" };
  const p = input.params;
  if (p.alg !== undefined && p.alg !== "ed25519") return { kind: "invalid", reason: "alg must be ed25519" };
  for (const need of ["@authority", "signature-agent"]) {
    if (!input.components.includes(need)) return { kind: "invalid", reason: `${need} must be signed` };
  }
  const created = Number(p.created);
  const expires = Number(p.expires);
  if (!Number.isFinite(created) || !Number.isFinite(expires)) return { kind: "invalid", reason: "created and expires required" };
  if (created > opts.now + opts.clockSkewSeconds) return { kind: "invalid", reason: "created in the future" };
  if (expires <= opts.now - opts.clockSkewSeconds) return { kind: "invalid", reason: "signature expired" };
  if (expires - created > opts.maxValiditySeconds) return { kind: "invalid", reason: "validity window too long" };
  const signature = sigs.get(input.label);
  if (!signature) return { kind: "invalid", reason: "signature label not found" };

  const agent = agentHeader.trim().replace(/^"|"$/g, "");
  let operator: string;
  try {
    const u = new URL(agent);
    if (u.protocol !== "https:") return { kind: "invalid", reason: "signature-agent must be https" };
    operator = u.host.toLowerCase();
  } catch {
    return { kind: "invalid", reason: "signature-agent is not a URL" };
  }
  let keys: Jwk[];
  try {
    keys = await resolver.keys(agent);
  } catch {
    return { kind: "invalid", reason: "key directory unavailable" };
  }
  let jwk: Jwk | undefined;
  for (const k of keys) {
    if (k.kty === "OKP" && k.crv === "Ed25519" && (await thumbprint(k)) === p.keyid) jwk = k;
  }
  if (!jwk) return { kind: "invalid", reason: "keyid not in the agent's key directory" };
  let base: string;
  try {
    base = signatureBase(req, input);
  } catch (e) {
    return { kind: "invalid", reason: (e as Error).message };
  }
  const key = await crypto.subtle.importKey("jwk", { ...jwk }, { name: "Ed25519" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("Ed25519", key, signature, enc.encode(base));
  if (!ok) return { kind: "invalid", reason: "signature does not verify" };
  return { kind: "verified", operator, keyid: String(p.keyid), agent };
}

/** Used by agents (and by the simulator) to sign a request the way the draft describes. */
export async function signRequest(
  req: Request,
  privateKey: CryptoKey,
  publicJwk: Jwk,
  signatureAgent: string,
  now: number,
  validitySeconds = 60,
  nonce?: string,
): Promise<Request> {
  const keyid = await thumbprint(publicJwk);
  const headers = new Headers(req.headers);
  headers.set("signature-agent", `"${signatureAgent}"`);
  const params =
    `("@authority" "signature-agent");created=${now};keyid="${keyid}";alg="ed25519";expires=${now + validitySeconds}` +
    (nonce ? `;nonce="${nonce}"` : "") +
    `;tag="web-bot-auth"`;
  headers.set("signature-input", `sig1=${params}`);
  const draft = new Request(req.url, { method: req.method, headers });
  const [input] = parseSignatureInput(`sig1=${params}`);
  const base = signatureBase(draft, input);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, enc.encode(base)));
  let s = "";
  for (const x of sig) s += String.fromCharCode(x);
  headers.set("signature", `sig1=:${btoa(s)}:`);
  return new Request(req.url, { method: req.method, headers, body: req.body });
}
