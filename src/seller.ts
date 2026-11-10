/**
 * The seller's book: every settled sale once (keyed by the settlement transaction), revenue by agent operator and
 * by route, what was refused and why, and what was served without a charge because the outcome was not delivered.
 * Written off the request path (ctx.waitUntil); read by the seller's API and the dashboard.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export interface Sale {
  tx: string;
  at: number;
  operator: string;
  rule: string;
  amount: string;
  payer: string;
}

export class SellerBook extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`create table if not exists sales (
      tx text primary key, at integer not null, operator text not null, rule text not null, amount text not null,
      payer text not null)`);
    this.sql.exec("create table if not exists counters (k text primary key, n integer not null)");
  }

  async recordSale(s: Sale): Promise<boolean> {
    const before = this.sql.exec("select count(*) as n from sales where tx = ?", s.tx).one().n as number;
    if (before) return false; // exactly once, whatever the retries
    this.sql.exec(
      "insert into sales (tx, at, operator, rule, amount, payer) values (?, ?, ?, ?, ?, ?)",
      s.tx,
      s.at,
      s.operator,
      s.rule,
      s.amount,
      s.payer,
    );
    return true;
  }

  async count(key: string): Promise<void> {
    this.sql.exec("insert into counters (k, n) values (?, 1) on conflict (k) do update set n = n + 1", key);
  }

  async report(): Promise<{
    sales: number;
    revenue: string;
    byOperator: Record<string, { sales: number; revenue: string }>;
    byRule: Record<string, { sales: number; revenue: string }>;
    counters: Record<string, number>;
  }> {
    const rows = this.sql.exec("select operator, rule, amount from sales").toArray() as {
      operator: string;
      rule: string;
      amount: string;
    }[];
    const byOperator: Record<string, { sales: number; revenue: bigint }> = {};
    const byRule: Record<string, { sales: number; revenue: bigint }> = {};
    let total = 0n;
    for (const r of rows) {
      const a = BigInt(r.amount);
      total += a;
      byOperator[r.operator] ??= { sales: 0, revenue: 0n };
      byOperator[r.operator].sales++;
      byOperator[r.operator].revenue += a;
      byRule[r.rule] ??= { sales: 0, revenue: 0n };
      byRule[r.rule].sales++;
      byRule[r.rule].revenue += a;
    }
    const fmt = (m: Record<string, { sales: number; revenue: bigint }>) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { sales: v.sales, revenue: v.revenue.toString() }]));
    const counters = Object.fromEntries(
      (this.sql.exec("select k, n from counters").toArray() as { k: string; n: number }[]).map((c) => [c.k, c.n]),
    );
    return { sales: rows.length, revenue: total.toString(), byOperator: fmt(byOperator), byRule: fmt(byRule), counters };
  }
}
