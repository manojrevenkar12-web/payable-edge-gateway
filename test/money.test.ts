import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide, matchRule, outcomeMet } from "../src/pricing";
import { formatAtomic, MoneyError, parseAtomic, toDisplay } from "../src/money";

describe("money", () => {
  it("round-trips every non-negative integer amount exactly", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 24n }), (v) => {
        expect(parseAtomic(formatAtomic(v))).toBe(v);
      }),
    );
  });

  it("refuses anything that is not a plain integer string", () => {
    for (const bad of ["1.5", "-1", "01", "1e6", " 1", "", "0x10", 5000]) {
      expect(() => parseAtomic(bad)).toThrow(MoneyError);
    }
  });

  it("formats for display without floating point", () => {
    expect(toDisplay(990000n)).toBe("0.990000");
    expect(toDisplay(12345678901234567890n)).toBe("12345678901234.567890");
  });
});

describe("pricing", () => {
  const verified = { kind: "verified" as const, operator: "crawler.agents.sim", keyid: "k", agent: "https://crawler.agents.sim" };
  it("matches routes and prices callers", () => {
    expect(matchRule("/articles/x")?.id).toBe("articles");
    expect(decide("/articles/x", verified)).toMatchObject({ kind: "charge", price: 5000n });
    expect(decide("/articles/x", { kind: "unverified" })).toMatchObject({ kind: "charge", price: 20000n });
    expect(decide("/api/search", { kind: "unverified" }).kind).toBe("block");
    expect(decide("/nowhere", verified).kind).toBe("block");
    expect(decide("/articles/x", { ...verified, operator: "search.agents.sim" }).kind).toBe("free");
  });

  it("charges for an outcome only when the origin says it happened", () => {
    const rule = matchRule("/api/resolve")!;
    expect(outcomeMet(rule, new Response("", { headers: { "x-outcome": "resolved" } }))).toBe(true);
    expect(outcomeMet(rule, new Response("", { headers: { "x-outcome": "unresolved" } }))).toBe(false);
    expect(outcomeMet(rule, new Response("", { status: 500, headers: { "x-outcome": "resolved" } }))).toBe(false);
  });
});
