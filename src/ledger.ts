/**
 * One PayerLedger per paying wallet. A Durable Object is a single writer, so every decision about one payer's
 * payments is serialised: a signed authorization can pay for one request, once.
 *
 *   (none) --reserve--> reserved --commit--> settled
 *                          |                    |
 *                       release              same resource, within the retry window: delivered again, no charge
 *                          v
 *                       released --reserve--> reserved      (the authorization was never settled, so it may pay later)
 *
 * Before anything new is reserved, the payer's spend inside the window (settled, plus reservations still live) plus
 * this amount must stay within the cap, so a leaked agent key cannot drain a wallet faster than the cap allows.
 *
 * The chain is the backstop: if a worker dies after settling but before committing, the chain has the nonce as used
 * and refuses a second settlement, so a stale reservation can be taken over without risking a double charge.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export type ReserveResult =
  | { ok: true; mode: "new" }
  | { ok: true; mode: "redeliver"; tx: string }
  | { ok: false; reason: string };

export interface ReserveArgs {
  nonce: string;
  amount: string;
  resource: string;
  requestId: string;
  now: number; // ms
  leaseMs: number;
  redeliverMs: number;
  /** atomic units this payer may have settled or reserved inside the window, this request included */
  capAmount: bigint;
  capWindowMs: number;
}

export class PayerLedger extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`create table if not exists payments (
      nonce text primary key, state text not null, amount text not null, resource text not null,
      request_id text not null, reserved_at integer not null, settled_at integer, tx text, reason text)`);
  }

  async reserve(a: ReserveArgs): Promise<ReserveResult> {
    const row = this.sql.exec("select * from payments where nonce = ?", a.nonce).toArray()[0] as
      | Record<string, string | number | null>
      | undefined;
    if (!row || row.state !== "settled") {
      if (!(row?.state === "reserved" && a.now - Number(row.reserved_at) < a.leaseMs)) {
        const spent = this.spentSince(a.now - a.capWindowMs, a.now - a.leaseMs);
        if (spent + BigInt(a.amount) > a.capAmount) return { ok: false, reason: "payer spending limit reached" };
      }
    }
    if (!row) {
      this.sql.exec(
        "insert into payments (nonce, state, amount, resource, request_id, reserved_at) values (?, 'reserved', ?, ?, ?, ?)",
        a.nonce,
        a.amount,
        a.resource,
        a.requestId,
        a.now,
      );
      return { ok: true, mode: "new" };
    }
    if (row.state === "settled") {
      if (row.resource === a.resource && a.now - Number(row.settled_at) <= a.redeliverMs) {
        return { ok: true, mode: "redeliver", tx: String(row.tx) };
      }
      return { ok: false, reason: "payment already used" };
    }
    if (row.state === "reserved" && a.now - Number(row.reserved_at) < a.leaseMs) {
      return { ok: false, reason: "payment in use by another request" };
    }
    // released, or a reservation whose worker went away: the chain will refuse it if it was in fact settled
    this.sql.exec(
      "update payments set state = 'reserved', amount = ?, resource = ?, request_id = ?, reserved_at = ?, reason = null where nonce = ?",
      a.amount,
      a.resource,
      a.requestId,
      a.now,
      a.nonce,
    );
    return { ok: true, mode: "new" };
  }

  private spentSince(windowStart: number, liveReservedAfter: number): bigint {
    const rows = this.sql
      .exec(
        "select amount from payments where (state = 'settled' and settled_at >= ?) or (state = 'reserved' and reserved_at >= ?)",
        windowStart,
        liveReservedAfter,
      )
      .toArray() as { amount: string }[];
    return rows.reduce((s, r) => s + BigInt(r.amount), 0n);
  }

  async commit(nonce: string, tx: string, now: number): Promise<void> {
    this.sql.exec("update payments set state = 'settled', tx = ?, settled_at = ? where nonce = ? and state = 'reserved'", tx, now, nonce);
  }

  async release(nonce: string, reason: string): Promise<void> {
    this.sql.exec("update payments set state = 'released', reason = ? where nonce = ? and state = 'reserved'", reason, nonce);
  }

  async summary(): Promise<{ settled: number; settledAmount: string; released: number; reserved: number }> {
    const rows = this.sql.exec("select state, amount from payments").toArray() as { state: string; amount: string }[];
    let settledAmount = 0n;
    let settled = 0;
    let released = 0;
    let reserved = 0;
    for (const r of rows) {
      if (r.state === "settled") {
        settled++;
        settledAmount += BigInt(r.amount);
      } else if (r.state === "released") released++;
      else reserved++;
    }
    return { settled, settledAmount: settledAmount.toString(), released, reserved };
  }
}
