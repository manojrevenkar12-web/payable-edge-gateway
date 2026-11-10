/** Atomic amounts are integer strings (USDC has 6 decimals). Formatting never goes through a float. */
export function formatUsdc(atomic: string, decimals = 6, shown = 2): string {
  const neg = atomic.startsWith("-");
  const digits = (neg ? atomic.slice(1) : atomic).padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = digits.slice(-decimals).slice(0, shown);
  return `${neg ? "-" : ""}${whole}${shown > 0 ? `.${frac}` : ""}`;
}

/** share of a total, both atomic strings, as a 0..1 number for drawing only */
export function shareOf(part: string, total: string): number {
  const t = BigInt(total);
  if (t === 0n) return 0;
  return Number((BigInt(part) * 10000n) / t) / 10000;
}

export const count = (n: number) => n.toLocaleString("en-GB");
