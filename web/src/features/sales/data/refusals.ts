/** Counter names from the gateway, in words a seller reads. Unknown counters keep their raw name. */
const LABELS: Record<string, string> = {
  "refused:payment in use by another request": "Same payment sent again while the first was still running",
  "refused:payment already used": "Payment reused for a different page",
  "refused:bot signature rejected": "Agent signature did not check out",
  "refused:amount below the price": "Paid less than the price",
  "refused:authorization expired": "Payment authorization had expired",
  "refused:key is not the payer's": "Signed with someone else's wallet key",
  "refused:insufficient funds": "Wallet could not cover the price",
  "refused:blocked": "Unverified caller on a route for verified agents only",
  "refused:payer spending limit reached": "Wallet hit its spending limit",
};

export function refusalsFrom(counters: Record<string, number>) {
  return Object.entries(counters)
    .filter(([k]) => k.startsWith("refused:"))
    .map(([k, n]) => ({ key: k, label: LABELS[k] ?? k.slice("refused:".length), count: n }))
    .sort((a, b) => b.count - a.count);
}

export function deliveredFree(counters: Record<string, number>) {
  return {
    redelivered: counters.redelivered ?? 0,
    outcomeNotMet: counters["not charged:outcome not met"] ?? 0,
    partner: Object.entries(counters).filter(([k]) => k.startsWith("free:") && k !== "free:home").reduce((s, [, n]) => s + n, 0),
  };
}
