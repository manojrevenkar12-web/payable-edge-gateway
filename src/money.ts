/**
 * Money is an integer number of the asset's atomic units (USDC has 6 decimals, so 1 USD = 1_000_000).
 * It travels as a decimal string (as x402 does), lives as a bigint, and never touches a float.
 */

export type Atomic = bigint;

const DIGITS = /^(0|[1-9][0-9]*)$/;

export function parseAtomic(s: unknown): Atomic {
  if (typeof s !== "string" || !DIGITS.test(s) || s.length > 30) {
    throw new MoneyError(`not an amount in atomic units: ${JSON.stringify(s)}`);
  }
  return BigInt(s);
}

export function formatAtomic(a: Atomic): string {
  if (a < 0n) throw new MoneyError("negative amount");
  return a.toString();
}

/** "1.234567" for display only; never parsed back. */
export function toDisplay(a: Atomic, decimals = 6): string {
  const neg = a < 0n;
  const v = neg ? -a : a;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export class MoneyError extends Error {}
