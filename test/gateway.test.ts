import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { type Agent, balance, makeAgent, makeWallet, paid, pay, paymentResponse, quote, report, signed, SITE } from "./helpers";

let crawler: Agent;
let search: Agent;

beforeAll(async () => {
  crawler = await makeAgent("crawler.agents.sim");
  search = await makeAgent("search.agents.sim");
});

describe("who pays what", () => {
  it("the home page is free", async () => {
    expect((await SELF.fetch(`${SITE}/`)).status).toBe(200);
  });

  it("quotes per caller: unverified 20000, verified 5000, a partner nothing", async () => {
    expect((await quote(null, `${SITE}/articles/a`)).maxAmountRequired).toBe("20000");
    expect((await quote(crawler, `${SITE}/articles/a`)).maxAmountRequired).toBe("5000");
    const r = await SELF.fetch(await signed(search, `${SITE}/articles/a`));
    expect(r.status).toBe(200);
  });

  it("blocks unverified callers where the seller says so, and refuses bad signatures", async () => {
    expect((await SELF.fetch(`${SITE}/api/search?q=x`)).status).toBe(403);
    const stranger = await makeAgent("stranger.agents.sim", false); // never published its keys
    const r = await SELF.fetch(await signed(stranger, `${SITE}/articles/a`));
    expect(r.status).toBe(401);
  });
});

describe("paying", () => {
  it("pays once, exactly, and the books agree with the chain", async () => {
    const w = await makeWallet("100000");
    const url = `${SITE}/articles/pay-once`;
    const req = await quote(crawler, url);
    const r = await paid(crawler, url, await pay(w, req));
    expect(r.status).toBe(200);
    const pr = paymentResponse(r)!;
    expect(pr.success).toBe(true);
    expect(String(pr.transaction)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await balance(w.address)).toBe(95000n);
    const rep = await report();
    expect(rep.reconciliation.matches).toBe(true);
  });

  it("refuses the wrong amount, recipient or network, and charges nothing", async () => {
    const w = await makeWallet("100000");
    const url = `${SITE}/articles/wrong`;
    const req = await quote(crawler, url);
    const cases: [Record<string, string>, string][] = [
      [{ value: "4999" }, "amount below the price"],
      [{ value: "5001" }, "amount above the price"],
      [{ to: "0x000000000000000000000000000000000000dead" }, "pays someone else"],
      [{ network: "base" }, "wrong network"],
    ];
    for (const [over, reason] of cases) {
      const r = await paid(crawler, url, await pay(w, req, over));
      expect(r.status).toBe(402);
      expect(((await r.json()) as { error: string }).error).toBe(reason);
    }
    expect(await balance(w.address)).toBe(100000n);
  });

  it("refuses an expired authorization, insufficient funds and someone else's key", async () => {
    const url = `${SITE}/articles/refusals`;
    const req = await quote(crawler, url);
    const rich = await makeWallet("100000");
    const expired = await paid(crawler, url, await pay(rich, req, { validBefore: String(Math.floor(Date.now() / 1000) - 1) }));
    expect(((await expired.json()) as { error: string }).error).toBe("authorization expired");
    const poor = await makeWallet("100");
    const broke = await paid(crawler, url, await pay(poor, req));
    expect(((await broke.json()) as { error: string }).error).toBe("insufficient funds");
    const thief = await makeWallet("0");
    const stolen = await paid(crawler, url, await pay(rich, req, { publicKey: thief.publicKey }));
    expect(stolen.status).toBe(402);
    expect(await balance(rich.address)).toBe(100000n);
  });
});

describe("replays and double spends", () => {
  it("a payment cannot buy a second resource; the same resource is delivered again without a charge", async () => {
    const w = await makeWallet("100000");
    const url = `${SITE}/articles/replay`;
    const header = await pay(w, await quote(crawler, url));
    expect((await paid(crawler, url, header)).status).toBe(200);
    const again = await paid(crawler, url, header); // the agent retried after a timeout
    expect(again.status).toBe(200);
    expect(paymentResponse(again)!.redelivery).toBe(true);
    const other = await paid(crawler, `${SITE}/articles/replay-elsewhere`, header);
    expect(other.status).toBe(402);
    expect(await balance(w.address)).toBe(95000n);
  });

  it("twenty concurrent copies of one payment charge it once", async () => {
    const w = await makeWallet("100000");
    const url = `${SITE}/articles/burst`;
    const header = await pay(w, await quote(crawler, url));
    const rs = await Promise.all(Array.from({ length: 20 }, () => paid(crawler, url, header)));
    const settledTx = new Set(rs.filter((r) => r.status === 200).map((r) => String(paymentResponse(r)!.transaction)));
    expect(settledTx.size).toBe(1);
    expect(await balance(w.address)).toBe(95000n);
  });
});

describe("charging for outcomes", () => {
  it("an unresolved ticket is served but not charged; the same authorization pays when it resolves", async () => {
    const w = await makeWallet("5000000");
    const req = await quote(crawler, `${SITE}/api/resolve?ticket=3`);
    const header = await pay(w, req);
    const miss = await paid(crawler, `${SITE}/api/resolve?ticket=3`, header);
    expect(miss.status).toBe(200);
    expect(paymentResponse(miss)).toMatchObject({ success: false, errorReason: "outcome_not_met" });
    expect(await balance(w.address)).toBe(5000000n);

    const req2 = await quote(crawler, `${SITE}/api/resolve?ticket=1`);
    const hit = await paid(crawler, `${SITE}/api/resolve?ticket=1`, await pay(w, req2));
    expect(paymentResponse(hit)!.success).toBe(true);
    expect(await balance(w.address)).toBe(5000000n - 990000n);
  });

  it("a payer cannot spend past its cap inside the window, so a leaked agent cannot drain a wallet", async () => {
    const w = await makeWallet("30000000");
    const tickets = Array.from({ length: 40 }, (_, i) => i + 1000).filter((t) => t % 7 !== 3 && t % 50 !== 49).slice(0, 16);
    const statuses: number[] = [];
    for (const t of tickets) {
      const url = `${SITE}/api/resolve?ticket=${t}`;
      const r = await paid(crawler, url, await pay(w, await quote(crawler, url)));
      statuses.push(r.status);
      if (r.status === 402) expect(((await r.json()) as { error: string }).error).toBe("payer spending limit reached");
    }
    expect(statuses.slice(0, 15).every((s) => s === 200)).toBe(true); // 15 x 0.99 = 14.85 within the 15.00 cap
    expect(statuses[15]).toBe(402);
    expect(await balance(w.address)).toBe(30000000n - 15n * 990000n);
  });

  it("an origin error is never charged", async () => {
    const w = await makeWallet("5000000");
    const url = `${SITE}/api/resolve?ticket=49`;
    const r = await paid(crawler, url, await pay(w, await quote(crawler, url)));
    expect(r.status).toBe(503);
    expect(await balance(w.address)).toBe(5000000n);
  });
});

describe("the seller's API", () => {
  it("needs the admin token and reconciles to the chain", async () => {
    expect((await SELF.fetch(`${SITE}/__admin/report`)).status).toBe(401);
    const rep = await report();
    expect(rep.reconciliation.matches).toBe(true);
    expect(rep.sales).toBe(rep.reconciliation.chain.count);
  });
});
