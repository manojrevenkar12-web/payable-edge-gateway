/**
 * Simulated settlement network and agent key directories, for tests and the simulator (env.SIM = "1").
 *
 * SimChain behaves like an x402 facilitator over an EIP-3009 token: an authorization moves `value` from `from` to
 * `to` once, inside its validity window, if `from` has the balance. Its signature is Ed25519 over the authorization
 * instead of EIP-712/secp256k1, and the payer's address is derived from the public key it carries.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { parseAtomic } from "./money";
import { addressOf, authorizationMessage, b64ToBytes } from "./simcrypto";
import { b64urlToBytes, type Jwk } from "./webbotauth";
import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "./x402";

export { addressOf, authorizationMessage } from "./simcrypto";

export class SimChain extends DurableObject<Env> {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("create table if not exists balances (address text primary key, amount text not null)");
    this.sql.exec("create table if not exists used (nonce text primary key, tx text not null)");
    this.sql.exec(
      "create table if not exists txs (tx text primary key, at integer, sender text, receiver text, value text, nonce text)",
    );
  }

  private balance(addr: string): bigint {
    const r = this.sql.exec("select amount from balances where address = ?", addr.toLowerCase()).toArray()[0];
    return r ? BigInt(r.amount as string) : 0n;
  }

  private setBalance(addr: string, v: bigint) {
    this.sql.exec(
      "insert into balances (address, amount) values (?, ?) on conflict (address) do update set amount = excluded.amount",
      addr.toLowerCase(),
      v.toString(),
    );
  }

  async fund(addr: string, amount: string): Promise<void> {
    this.setBalance(addr, this.balance(addr) + parseAtomic(amount));
  }

  async verify(p: PaymentPayload, req: PaymentRequirements, nowSeconds: number): Promise<VerifyResponse> {
    const a = p.payload.authorization;
    const pub = p.payload.publicKey;
    if (!pub) return { isValid: false, invalidReason: "missing public key" };
    if ((await addressOf(pub)) !== a.from.toLowerCase()) return { isValid: false, invalidReason: "key is not the payer's" };
    const key = await crypto.subtle.importKey("raw", b64urlToBytes(pub), { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("Ed25519", key, b64ToBytes(p.payload.signature), authorizationMessage(p.network, a));
    if (!ok) return { isValid: false, invalidReason: "invalid signature" };
    if (a.to.toLowerCase() !== req.payTo.toLowerCase()) return { isValid: false, invalidReason: "wrong recipient" };
    if (parseAtomic(a.value) < parseAtomic(req.maxAmountRequired)) return { isValid: false, invalidReason: "insufficient value" };
    if (Number(a.validAfter) > nowSeconds) return { isValid: false, invalidReason: "not yet valid" };
    if (Number(a.validBefore) <= nowSeconds) return { isValid: false, invalidReason: "authorization expired" };
    if (this.sql.exec("select 1 from used where nonce = ?", a.nonce).toArray().length) {
      return { isValid: false, invalidReason: "nonce already used" };
    }
    if (this.balance(a.from) < parseAtomic(a.value)) return { isValid: false, invalidReason: "insufficient funds" };
    return { isValid: true, payer: a.from.toLowerCase() };
  }

  async settle(p: PaymentPayload, req: PaymentRequirements, nowSeconds: number): Promise<SettleResponse> {
    const v = await this.verify(p, req, nowSeconds);
    if (!v.isValid) return { success: false, errorReason: v.invalidReason, transaction: "", network: p.network };
    const a = p.payload.authorization;
    const value = parseAtomic(a.value);
    const txBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${p.network}:${a.from}:${a.nonce}`)));
    const tx = `0x${[...txBytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    this.setBalance(a.from, this.balance(a.from) - value);
    this.setBalance(a.to, this.balance(a.to) + value);
    this.sql.exec("insert into used (nonce, tx) values (?, ?)", a.nonce, tx);
    this.sql.exec(
      "insert into txs (tx, at, sender, receiver, value, nonce) values (?, ?, ?, ?, ?, ?)",
      tx,
      nowSeconds,
      a.from.toLowerCase(),
      a.to.toLowerCase(),
      a.value,
      a.nonce,
    );
    return { success: true, transaction: tx, network: p.network, payer: a.from.toLowerCase() };
  }

  async received(addr: string): Promise<{ count: number; total: string }> {
    const rows = this.sql.exec("select value from txs where receiver = ?", addr.toLowerCase()).toArray() as {
      value: string;
    }[];
    return { count: rows.length, total: rows.reduce((s, r) => s + BigInt(r.value), 0n).toString() };
  }

  async balanceOf(addr: string): Promise<string> {
    return this.balance(addr).toString();
  }
}

export class SimRegistry extends DurableObject<Env> {
  async put(host: string, keys: Jwk[]): Promise<void> {
    await this.ctx.storage.put(host.toLowerCase(), keys);
  }
  async keys(host: string): Promise<Jwk[]> {
    return ((await this.ctx.storage.get(host.toLowerCase())) as Jwk[] | undefined) ?? [];
  }
}
