import { env, SELF } from "cloudflare:test";
import { addressOf, authorizationMessage } from "../src/simcrypto";
import { bytesToB64url, type Jwk, signRequest } from "../src/webbotauth";
import { encodePayment, type PaymentPayload, type PaymentRequirements } from "../src/x402";

export const ADMIN = { authorization: `Bearer ${env.ADMIN_TOKEN}` };
export const SITE = "https://news.example";

export interface Agent {
  host: string;
  jwk: Jwk;
  key: CryptoKey;
}

export interface Wallet {
  address: string;
  publicKey: string;
  key: CryptoKey;
}

export async function makeAgent(host: string, register = true): Promise<Agent> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  const jwk: Jwk = { kty: "OKP", crv: "Ed25519", x: pub.x as string };
  if (register) {
    await SELF.fetch(`${SITE}/__admin/sim/register`, {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ host, keys: [jwk] }),
    });
  }
  return { host, jwk, key: kp.privateKey };
}

export async function makeWallet(funds = "1000000000"): Promise<Wallet> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const publicKey = bytesToB64url(raw);
  const address = await addressOf(publicKey);
  if (funds !== "0") {
    await SELF.fetch(`${SITE}/__admin/sim/fund`, {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ address, amount: funds }),
    });
  }
  return { address, publicKey, key: kp.privateKey };
}

export function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

export async function pay(
  w: Wallet,
  req: PaymentRequirements,
  over: Partial<{ value: string; to: string; validBefore: string; validAfter: string; nonce: string; network: string; publicKey: string }> = {},
): Promise<string> {
  const nonce = over.nonce ?? `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  const authorization = {
    from: w.address,
    to: over.to ?? req.payTo,
    value: over.value ?? req.maxAmountRequired,
    validAfter: over.validAfter ?? String(nowS() - 5),
    validBefore: over.validBefore ?? String(nowS() + 120),
    nonce,
  };
  const network = over.network ?? req.network;
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", w.key, authorizationMessage(network, authorization)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  const payload: PaymentPayload = {
    x402Version: 1,
    scheme: "exact",
    network,
    payload: { signature: btoa(s), authorization, publicKey: over.publicKey ?? w.publicKey },
  };
  return encodePayment(payload);
}

export async function signed(agent: Agent, url: string, init: RequestInit = {}): Promise<Request> {
  return signRequest(new Request(url, init), agent.key, agent.jwk, `https://${agent.host}`, nowS());
}

export async function quote(agent: Agent | null, url: string): Promise<PaymentRequirements> {
  const req = agent ? await signed(agent, url) : new Request(url);
  const r = await SELF.fetch(req);
  if (r.status !== 402) throw new Error(`expected 402, got ${r.status}`);
  return ((await r.json()) as { accepts: PaymentRequirements[] }).accepts[0];
}

export async function paid(agent: Agent | null, url: string, header: string): Promise<Response> {
  const req = agent ? await signed(agent, url, { headers: { "x-payment": header } }) : new Request(url, { headers: { "x-payment": header } });
  return SELF.fetch(req);
}

export function paymentResponse(r: Response): Record<string, unknown> | null {
  const h = r.headers.get("x-payment-response");
  return h ? (JSON.parse(atob(h)) as Record<string, unknown>) : null;
}

export async function report(): Promise<{
  sales: number;
  revenue: string;
  counters: Record<string, number>;
  byOperator: Record<string, { sales: number; revenue: string }>;
  reconciliation: { matches: boolean; chain: { count: number; total: string } };
}> {
  return (await (await SELF.fetch(`${SITE}/__admin/report`, { headers: ADMIN })).json()) as never;
}

export async function balance(address: string): Promise<bigint> {
  const r = (await (await SELF.fetch(`${SITE}/__admin/sim/payer?address=${address}`, { headers: ADMIN })).json()) as {
    balance: string;
  };
  return BigInt(r.balance);
}
