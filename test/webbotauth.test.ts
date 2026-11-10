import { describe, expect, it } from "vitest";
import { type Jwk, parseSignatureInput, signRequest, thumbprint, verifyRequest } from "../src/webbotauth";

const opts = (now: number) => ({ now, maxValiditySeconds: 3600, clockSkewSeconds: 30 });

async function agent() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  const jwk: Jwk = { kty: "OKP", crv: "Ed25519", x: pub.x as string };
  return { jwk, key: kp.privateKey, resolver: { keys: async () => [jwk] } };
}

describe("Web Bot Auth", () => {
  it("computes the RFC 7638 thumbprint of the RFC 9421 Ed25519 test key used in the draft", async () => {
    const jwk = { kty: "OKP", crv: "Ed25519", x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs" };
    expect(await thumbprint(jwk)).toBe("poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U");
  });

  it("parses Signature-Input and keeps the inner list verbatim for @signature-params", () => {
    const [p] = parseSignatureInput(
      'sig1=("@authority" "signature-agent");created=1735689600;keyid="k";alg="ed25519";expires=1735693200;tag="web-bot-auth"',
    );
    expect(p.components).toEqual(["@authority", "signature-agent"]);
    expect(p.params).toMatchObject({ created: 1735689600, keyid: "k", tag: "web-bot-auth" });
    expect(p.serialized.startsWith('("@authority" "signature-agent");created=')).toBe(true);
  });

  it("verifies a signed request and names the operator", async () => {
    const a = await agent();
    const now = 1_800_000_000;
    const req = await signRequest(new Request("https://news.example/articles/x"), a.key, a.jwk, "https://crawler.agents.sim", now);
    const who = await verifyRequest(req, a.resolver, opts(now + 5));
    expect(who).toMatchObject({ kind: "verified", operator: "crawler.agents.sim" });
  });

  it("an unsigned request is unverified; a bad signature is refused, never downgraded", async () => {
    const a = await agent();
    const now = 1_800_000_000;
    expect(await verifyRequest(new Request("https://news.example/"), a.resolver, opts(now))).toEqual({ kind: "unverified" });

    const req = await signRequest(new Request("https://news.example/a"), a.key, a.jwk, "https://crawler.agents.sim", now);
    const moved = new Request("https://other.example/a", { headers: req.headers }); // replayed against another host
    expect((await verifyRequest(moved, a.resolver, opts(now))).kind).toBe("invalid");

    const other = await agent(); // a key the operator never published
    const forged = await signRequest(new Request("https://news.example/a"), other.key, other.jwk, "https://crawler.agents.sim", now);
    expect(await verifyRequest(forged, a.resolver, opts(now))).toMatchObject({ reason: "keyid not in the agent's key directory" });
  });

  it("enforces the time window", async () => {
    const a = await agent();
    const now = 1_800_000_000;
    const req = await signRequest(new Request("https://news.example/a"), a.key, a.jwk, "https://crawler.agents.sim", now, 60);
    expect(await verifyRequest(req, a.resolver, opts(now + 120))).toMatchObject({ reason: "signature expired" });
    expect(await verifyRequest(req, a.resolver, opts(now - 120))).toMatchObject({ reason: "created in the future" });
    const long = await signRequest(new Request("https://news.example/a"), a.key, a.jwk, "https://crawler.agents.sim", now, 86400);
    expect(await verifyRequest(long, a.resolver, opts(now))).toMatchObject({ reason: "validity window too long" });
  });

  it("refuses a changed signature-agent header", async () => {
    const a = await agent();
    const now = 1_800_000_000;
    const req = await signRequest(new Request("https://news.example/a"), a.key, a.jwk, "https://crawler.agents.sim", now);
    const h = new Headers(req.headers);
    h.set("signature-agent", '"https://search.agents.sim"');
    const who = await verifyRequest(new Request(req.url, { headers: h }), a.resolver, opts(now));
    expect(who.kind).toBe("invalid");
  });
});
