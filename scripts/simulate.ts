/**
 * Runs the real Worker locally in workerd (wrangler's unstable_dev) and drives a seeded mix of honest and hostile
 * agent traffic at it. The simulator knows what every request should have cost, so it checks every wallet's
 * balance, the chain and the seller's book against that, and records round-trip latency per kind of request.
 *
 *   npm run sim            (writes reports/sim.json)
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import pricing from "../config/pricing.json";
import { addressOf, authorizationMessage } from "../src/simcrypto";
import { bytesToB64url, type Jwk, signRequest } from "../src/webbotauth";
import { encodePayment, type PaymentRequirements } from "../src/x402";

const N = Number(process.env.SIM_TASKS ?? 4000);
const CONCURRENCY = Number(process.env.SIM_CONCURRENCY ?? 16);
const SEED = Number(process.env.SIM_SEED ?? 7);
const ADMIN = { authorization: "Bearer dev-admin-token" };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

interface Agent {
  host: string;
  jwk: Jwk;
  key: CryptoKey;
}
interface Wallet {
  address: string;
  publicKey: string;
  key: CryptoKey;
  expectedSpend: bigint;
  funded: bigint;
}

const MIX: [string, number][] = [
  ["article", 32],
  ["search", 12],
  ["resolve", 10],
  ["partner", 5],
  ["unverified_article", 5],
  ["free_home", 6],
  ["retry_redelivery", 3],
  ["replay_other_resource", 4],
  ["double_spend_burst", 4],
  ["underpay", 3],
  ["expired", 3],
  ["forged_bot", 3],
  ["tampered_agent", 3],
  ["stolen_key", 3],
  ["broke", 2],
  ["unverified_blocked", 2],
];
const ATTACKS = new Set([
  "replay_other_resource",
  "double_spend_burst",
  "underpay",
  "expired",
  "forged_bot",
  "tampered_agent",
  "stolen_key",
  "broke",
  "unverified_blocked",
]);

function kindFor(): string {
  const total = MIX.reduce((s, [, w]) => s + w, 0);
  let x = rand() * total;
  for (const [k, w] of MIX) {
    x -= w;
    if (x <= 0) return k;
  }
  return MIX[0][0];
}

const nowS = () => Math.floor(Date.now() / 1000);

async function keypair() {
  return (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
}

async function main() {
  // everything here talks to a local workerd; keep wrangler from routing localhost through an outbound proxy
  for (const k of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) delete process.env[k];
  const { unstable_dev } = await import("wrangler");
  rmSync(".sim/state", { recursive: true, force: true }); // every run starts from an empty chain and empty books
  const worker = await unstable_dev("src/index.ts", {
    config: "wrangler.jsonc",
    persistTo: ".sim/state",
    experimental: { disableExperimentalWarning: true },
    logLevel: "error",
  } as never);
  const base = `http://${worker.address}:${worker.port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: ADMIN, body: JSON.stringify(body) });

  // operators: four paying agents, one partner, one that never published its keys
  const agents: Record<string, Agent> = {};
  for (const host of ["crawler-a.agents.sim", "crawler-b.agents.sim", "research.agents.sim", "shopping.agents.sim", "search.agents.sim", "spoof.agents.sim"]) {
    const kp = await keypair();
    const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
    agents[host] = { host, jwk: { kty: "OKP", crv: "Ed25519", x: pub.x as string }, key: kp.privateKey };
    if (host !== "spoof.agents.sim") await post("/__admin/sim/register", { host, keys: [agents[host].jwk] });
  }
  const payers = ["crawler-a.agents.sim", "crawler-b.agents.sim", "research.agents.sim", "shopping.agents.sim"];

  const wallets: Wallet[] = [];
  for (let i = 0; i < 80; i++) {
    const kp = await keypair();
    const publicKey = bytesToB64url(new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer));
    const w: Wallet = { address: await addressOf(publicKey), publicKey, key: kp.privateKey, expectedSpend: 0n, funded: 0n };
    const funds = i < 76 ? 20_000_000n : 0n; // the last four are empty
    if (funds) await post("/__admin/sim/fund", { address: w.address, amount: funds.toString() });
    w.funded = funds;
    wallets.push(w);
  }
  const funded = wallets.filter((w) => w.funded > 0n);
  const empty = wallets.filter((w) => w.funded === 0n);

  const signed = async (agent: Agent | null, url: string, headers: Record<string, string> = {}) => {
    const req = new Request(url, { headers });
    return agent ? signRequest(req, agent.key, agent.jwk, `https://${agent.host}`, nowS()) : req;
  };
  const quote = async (agent: Agent | null, url: string): Promise<PaymentRequirements> => {
    const r = await fetch(await signed(agent, url));
    if (r.status !== 402) throw new Error(`quote ${url}: ${r.status} ${await r.text()}`);
    return ((await r.json()) as { accepts: PaymentRequirements[] }).accepts[0];
  };
  const pay = async (w: Wallet, req: PaymentRequirements, over: Record<string, string> = {}) => {
    const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
    const authorization = {
      from: w.address,
      to: req.payTo,
      value: over.value ?? req.maxAmountRequired,
      validAfter: String(nowS() - 5),
      validBefore: over.validBefore ?? String(nowS() + 120),
      nonce,
    };
    const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", w.key, authorizationMessage(req.network, authorization)));
    return encodePayment({
      x402Version: 1,
      scheme: "exact",
      network: req.network,
      payload: { signature: Buffer.from(sig).toString("base64"), authorization, publicKey: over.publicKey ?? w.publicKey },
    });
  };
  const timed = async (req: Request) => {
    const t = performance.now();
    const r = await fetch(req);
    const body = await r.text();
    return { r, body, ms: performance.now() - t };
  };
  const pr = (r: Response) => {
    const h = r.headers.get("x-payment-response");
    return h ? (JSON.parse(Buffer.from(h, "base64").toString()) as Record<string, unknown>) : null;
  };

  interface Result {
    kind: string;
    ok: boolean; // the gateway did what it should have
    charged: bigint; // what the simulator expects to have been charged
    ms: number;
    note?: string;
  }
  let ticket = 0;
  let slug = 0;

  async function task(kind: string): Promise<Result> {
    const agent = agents[pick(payers)];
    const w = pick(funded);
    const article = `${base}/articles/story-${slug++}`;
    switch (kind) {
      case "article":
      case "search":
      case "unverified_article": {
        const url = kind === "search" ? `${base}/api/search?q=q${slug++}` : article;
        const who = kind === "unverified_article" ? null : agent;
        const q = await quote(who, url);
        const x = await timed(await signed(who, url, { "x-payment": await pay(w, q) }));
        const price = BigInt(q.maxAmountRequired);
        const ok = x.r.status === 200 && pr(x.r)?.success === true;
        if (ok) w.expectedSpend += price;
        return { kind, ok, charged: ok ? price : 0n, ms: x.ms };
      }
      case "resolve": {
        const t = ticket++;
        const url = `${base}/api/resolve?ticket=${t}`;
        const q = await quote(agent, url);
        const x = await timed(await signed(agent, url, { "x-payment": await pay(w, q) }));
        const shouldCharge = t % 50 !== 49 && t % 7 !== 3;
        const charged = pr(x.r)?.success === true;
        if (charged) w.expectedSpend += BigInt(q.maxAmountRequired);
        return { kind, ok: charged === shouldCharge, charged: charged ? BigInt(q.maxAmountRequired) : 0n, ms: x.ms, note: shouldCharge ? "resolved" : "not resolved" };
      }
      case "partner": {
        const x = await timed(await signed(agents["search.agents.sim"], article));
        return { kind, ok: x.r.status === 200, charged: 0n, ms: x.ms };
      }
      case "free_home": {
        const x = await timed(new Request(`${base}/`));
        return { kind, ok: x.r.status === 200, charged: 0n, ms: x.ms };
      }
      case "retry_redelivery": {
        const q = await quote(agent, article);
        const header = await pay(w, q);
        const first = await timed(await signed(agent, article, { "x-payment": header }));
        const again = await timed(await signed(agent, article, { "x-payment": header }));
        const ok = first.r.status === 200 && again.r.status === 200 && pr(again.r)?.redelivery === true;
        if (first.r.status === 200) w.expectedSpend += BigInt(q.maxAmountRequired);
        return { kind, ok, charged: BigInt(q.maxAmountRequired), ms: again.ms };
      }
      case "replay_other_resource": {
        const q = await quote(agent, article);
        const header = await pay(w, q);
        const first = await timed(await signed(agent, article, { "x-payment": header }));
        if (first.r.status === 200) w.expectedSpend += BigInt(q.maxAmountRequired);
        const replay = await timed(await signed(agent, `${base}/articles/story-${slug++}`, { "x-payment": header }));
        return { kind, ok: replay.r.status === 402, charged: BigInt(q.maxAmountRequired), ms: replay.ms };
      }
      case "double_spend_burst": {
        const q = await quote(agent, article);
        const header = await pay(w, q);
        const xs = await Promise.all(Array.from({ length: 5 }, async () => timed(await signed(agent, article, { "x-payment": header }))));
        const txs = new Set(xs.filter((x) => x.r.status === 200).map((x) => String(pr(x.r)?.transaction)));
        if (txs.size >= 1) w.expectedSpend += BigInt(q.maxAmountRequired);
        return { kind, ok: txs.size === 1, charged: BigInt(q.maxAmountRequired), ms: Math.max(...xs.map((x) => x.ms)) };
      }
      case "underpay":
      case "expired":
      case "stolen_key": {
        const q = await quote(agent, article);
        const over: Record<string, string> =
          kind === "underpay"
            ? { value: String(BigInt(q.maxAmountRequired) - 1n) }
            : kind === "expired"
              ? { validBefore: String(nowS() - 1) }
              : { publicKey: pick(funded.filter((o) => o !== w)).publicKey };
        const x = await timed(await signed(agent, article, { "x-payment": await pay(w, q, over) }));
        return { kind, ok: x.r.status === 402, charged: 0n, ms: x.ms };
      }
      case "broke": {
        const q = await quote(agent, article);
        const x = await timed(await signed(agent, article, { "x-payment": await pay(pick(empty), q) }));
        return { kind, ok: x.r.status === 402, charged: 0n, ms: x.ms };
      }
      case "forged_bot": {
        const x = await timed(await signed(agents["spoof.agents.sim"], article));
        return { kind, ok: x.r.status === 401, charged: 0n, ms: x.ms };
      }
      case "tampered_agent": {
        const req = await signed(agent, article);
        const h = new Headers(req.headers);
        h.set("signature-agent", `"https://${pick(payers.filter((p) => p !== agent.host))}"`);
        const x = await timed(new Request(article, { headers: h }));
        return { kind, ok: x.r.status === 401, charged: 0n, ms: x.ms };
      }
      case "unverified_blocked": {
        const x = await timed(new Request(`${base}/api/search?q=x`));
        return { kind, ok: x.r.status === 403, charged: 0n, ms: x.ms };
      }
    }
    throw new Error(kind);
  }

  // unloaded latency first: one request at a time, the same free page and the same kind of paid article
  const probe = { free: [] as number[], paid: [] as number[] };
  for (let i = 0; i < 200; i++) {
    probe.free.push((await timed(new Request(`${base}/`))).ms);
    const url = `${base}/articles/probe-${i}`;
    const agent = agents[payers[i % payers.length]];
    const w = funded[(i % (funded.length - 1)) + 1];
    const q = await quote(agent, url);
    const x = await timed(await signed(agent, url, { "x-payment": await pay(w, q) }));
    if (pr(x.r)?.success === true) w.expectedSpend += BigInt(q.maxAmountRequired);
    probe.paid.push(x.ms);
  }

  const kinds = Array.from({ length: N }, kindFor);
  const results: Result[] = [];
  const t0 = performance.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < kinds.length) {
        const k = kinds[next++];
        try {
          results.push(await task(k));
        } catch (e) {
          results.push({ kind: k, ok: false, charged: 0n, ms: 0, note: String(e) });
        }
      }
    }),
  );
  const wall = (performance.now() - t0) / 1000;

  // a leaked agent key: one wallet spends on outcomes, one after another, until the ledger stops it
  const cap = BigInt(pricing.limits.payerSpendCap.amount);
  const drained = wallets[0];
  let capSpent = 0n;
  let capRefusedAt = -1;
  for (let i = 0; i < 40 && capRefusedAt < 0; i++) {
    const url = `${base}/api/resolve?ticket=${7 * (10000 + i)}`; // multiples of 7 that never fail
    const agent = agents[payers[0]];
    const q = await quote(agent, url);
    const r = await fetch(await signed(agent, url, { "x-payment": await pay(drained, q) }));
    if (r.status === 402) capRefusedAt = i;
    else if (pr(r)?.success === true) {
      capSpent += BigInt(q.maxAmountRequired);
      drained.expectedSpend += BigInt(q.maxAmountRequired);
    }
  }
  await new Promise((r) => setTimeout(r, 500)); // let waitUntil() writes land

  // every wallet against what it should have paid
  let walletMismatches = 0;
  let expectedTotal = 0n;
  for (const w of wallets) {
    const r = (await (await fetch(`${base}/__admin/sim/payer?address=${w.address}`, { headers: ADMIN })).json()) as { balance: string };
    const want = w.funded - w.expectedSpend;
    expectedTotal += w.expectedSpend;
    if (BigInt(r.balance) !== want) walletMismatches++;
  }
  const report = (await (await fetch(`${base}/__admin/report`, { headers: ADMIN })).json()) as Record<string, unknown> & {
    revenue: string;
    sales: number;
    reconciliation: { matches: boolean; chain: { count: number; total: string } };
  };
  await worker.stop();

  const pct = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 100) / 100 : null;
  };
  const byKind: Record<string, unknown> = {};
  for (const [k] of MIX) {
    const rs = results.filter((r) => r.kind === k);
    byKind[k] = {
      tasks: rs.length,
      correct: rs.filter((r) => r.ok).length,
      attack: ATTACKS.has(k),
      p50_ms: pct(rs.map((r) => r.ms), 50),
      p99_ms: pct(rs.map((r) => r.ms), 99),
      errors: rs.filter((r) => r.note?.startsWith("Error")).map((r) => r.note).slice(0, 3),
    };
  }
  const attacks = results.filter((r) => ATTACKS.has(r.kind));
  const paidOnes = results.filter((r) => ["article", "search", "unverified_article"].includes(r.kind));
  const out = {
    tasks: results.length,
    http_requests_approx: results.length * 2 + results.filter((r) => r.kind === "double_spend_burst").length * 4,
    concurrency: CONCURRENCY,
    seed: SEED,
    wall_seconds: Math.round(wall * 10) / 10,
    tasks_per_second: Math.round(results.length / wall),
    correct: results.filter((r) => r.ok).length,
    spending_cap: {
      cap: cap.toString(),
      wallet_spend_before_drain: (drained.expectedSpend - capSpent).toString(),
      drained_in_window: capSpent.toString(),
      refused_at_request: capRefusedAt,
      held: capRefusedAt >= 0 && drained.expectedSpend <= cap,
    },
    attacks: { tasks: attacks.length, refused_or_contained: attacks.filter((r) => r.ok).length },
    wallets: { checked: wallets.length, mismatched: walletMismatches },
    expected_revenue: expectedTotal.toString(),
    book_revenue: report.revenue,
    chain_revenue: report.reconciliation.chain.total,
    book_matches_chain: report.reconciliation.matches,
    expected_matches_book: expectedTotal.toString() === report.revenue,
    latency_unloaded_ms: {
      requests: probe.free.length,
      free_route: { p50: pct(probe.free, 50), p95: pct(probe.free, 95), p99: pct(probe.free, 99) },
      paid_request: { p50: pct(probe.paid, 50), p95: pct(probe.paid, 95), p99: pct(probe.paid, 99) },
      payment_overhead_p50: Math.round(((pct(probe.paid, 50) ?? 0) - (pct(probe.free, 50) ?? 0)) * 100) / 100,
    },
    latency_ms: {
      free_route: { p50: pct(results.filter((r) => r.kind === "free_home").map((r) => r.ms), 50), p99: pct(results.filter((r) => r.kind === "free_home").map((r) => r.ms), 99) },
      paid_request: { p50: pct(paidOnes.map((r) => r.ms), 50), p99: pct(paidOnes.map((r) => r.ms), 99) },
    },
    by_kind: byKind,
    seller_report: report,
    pricing: pricing.rules.map((r) => ({ id: r.id, ...("price" in r ? { price: r.price } : { free: true }) })),
  };
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/sim.json", `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify({ ...out, by_kind: undefined, seller_report: undefined, pricing: undefined }, null, 1));
  const bad = results.filter((r) => !r.ok);
  if (bad.length) console.log("not as expected:", bad.slice(0, 8));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
