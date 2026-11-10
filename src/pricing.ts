/**
 * Pricing is configuration, not code: config/pricing.json says, per route, what a verified agent pays, what an
 * unverified caller pays (or that it is blocked), which operators are partners, and whether the charge is on
 * delivery or only on a verified outcome.
 */

import config from "../config/pricing.json";
import type { BotIdentity } from "./webbotauth";
import { type Atomic, parseAtomic } from "./money";

export interface OutcomeRule {
  status: "2xx";
  header: string;
  equals: string;
}

export interface Rule {
  id: string;
  description?: string;
  match: { path: string };
  free?: boolean;
  price?: { verified: string; unverified: string };
  partners?: Record<string, string>;
  charge?: "on_delivery" | "on_outcome";
  outcome?: OutcomeRule;
}

export type Decision =
  | { kind: "free"; rule: Rule }
  | { kind: "block"; rule: Rule; reason: string }
  | { kind: "charge"; rule: Rule; price: Atomic; onOutcome: boolean };

export const pricing = config as unknown as {
  seller: { id: string; payTo: string; network: string; asset: string; decimals: number };
  limits: {
    maxTimeoutSeconds: number;
    signatureMaxValiditySeconds: number;
    clockSkewSeconds: number;
    keyDirectoryCacheSeconds: number;
    deliveryRetrySeconds: number;
    payerSpendCap: { amount: string; windowSeconds: number };
  };
  rules: Rule[];
};

export function matchRule(path: string, rules: Rule[] = pricing.rules): Rule | undefined {
  return rules.find((r) =>
    r.match.path.endsWith("/*") ? path.startsWith(r.match.path.slice(0, -1)) : path === r.match.path,
  );
}

export function decide(path: string, who: BotIdentity, rules: Rule[] = pricing.rules): Decision {
  const rule = matchRule(path, rules);
  if (!rule) return { kind: "block", rule: { id: "none", match: { path } }, reason: "no rule for this path" };
  if (rule.free) return { kind: "free", rule };
  if (!rule.price) return { kind: "block", rule, reason: "rule has no price" };
  let raw: string;
  if (who.kind === "verified") {
    raw = rule.partners?.[who.operator] ?? rule.price.verified;
  } else {
    raw = rule.price.unverified;
  }
  if (raw === "block") return { kind: "block", rule, reason: "this resource is for verified agents only" };
  const price = parseAtomic(raw);
  if (price === 0n) return { kind: "free", rule };
  return { kind: "charge", rule, price, onOutcome: rule.charge === "on_outcome" };
}

/** Did the origin deliver the outcome the buyer pays for? Only then does an on_outcome charge settle. */
export function outcomeMet(rule: Rule, res: Response): boolean {
  if (res.status < 200 || res.status > 299) return false;
  if (!rule.outcome) return true;
  return res.headers.get(rule.outcome.header) === rule.outcome.equals;
}
