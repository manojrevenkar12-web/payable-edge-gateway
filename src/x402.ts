/**
 * x402 (version 1): a server answers 402 Payment Required with what it accepts; the client retries with an
 * X-PAYMENT header carrying a signed payment authorization; the server verifies it with a facilitator, serves the
 * request, settles, and returns X-PAYMENT-RESPONSE.
 *
 * The "exact" scheme on EVM chains signs an EIP-3009 transferWithAuthorization with EIP-712 (secp256k1). The
 * simulated network "sim-base" keeps the same authorization fields and replaces only the signature algorithm with
 * Ed25519 (the payer's public key travels in the payload). The facilitator interface is the real one.
 */

import { type Atomic, formatAtomic, parseAtomic } from "./money";

export const X402_VERSION = 1;

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
}

export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: "exact";
  network: string;
  payload: { signature: string; authorization: Authorization; publicKey?: string };
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  transaction: string;
  network: string;
  payer?: string;
}

/** Coinbase's facilitator API shape; the simulated chain and an HTTP facilitator both implement it. */
export interface Facilitator {
  verify(payload: PaymentPayload, req: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, req: PaymentRequirements): Promise<SettleResponse>;
}

export class HttpFacilitator implements Facilitator {
  constructor(
    private url: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async call<T>(path: string, payload: PaymentPayload, req: PaymentRequirements): Promise<T> {
    const r = await this.fetcher(`${this.url}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: req }),
    });
    if (!r.ok) throw new Error(`facilitator ${path} answered ${r.status}`);
    return (await r.json()) as T;
  }
  verify(payload: PaymentPayload, req: PaymentRequirements) {
    return this.call<VerifyResponse>("verify", payload, req);
  }
  settle(payload: PaymentPayload, req: PaymentRequirements) {
    return this.call<SettleResponse>("settle", payload, req);
  }
}

export function paymentRequired(accepts: PaymentRequirements[], error: string): Response {
  return new Response(JSON.stringify({ x402Version: X402_VERSION, error, accepts }), {
    status: 402,
    headers: { "content-type": "application/json" },
  });
}

export function decodePayment(header: string): PaymentPayload {
  let p: PaymentPayload;
  try {
    p = JSON.parse(atob(header)) as PaymentPayload;
  } catch {
    throw new X402Error("X-PAYMENT is not base64 JSON");
  }
  if (p.x402Version !== X402_VERSION) throw new X402Error("unsupported x402Version");
  if (p.scheme !== "exact") throw new X402Error("unsupported scheme");
  const a = p.payload?.authorization;
  if (!a || !p.payload.signature) throw new X402Error("missing authorization");
  for (const k of ["from", "to", "value", "validAfter", "validBefore", "nonce"] as const) {
    if (typeof a[k] !== "string") throw new X402Error(`authorization.${k} missing`);
  }
  parseAtomic(a.value);
  return p;
}

export function encodePayment(p: PaymentPayload): string {
  return btoa(JSON.stringify(p));
}

export function encodePaymentResponse(r: Record<string, unknown>): string {
  return btoa(JSON.stringify(r));
}

/** Checks that only the gateway can make: does this payment pay for this resource, at this price, to this seller? */
export function matchesRequirements(p: PaymentPayload, req: PaymentRequirements, price: Atomic): string | null {
  const a = p.payload.authorization;
  if (p.network !== req.network) return "wrong network";
  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) return "pays someone else";
  if (parseAtomic(a.value) < price) return "amount below the price";
  if (parseAtomic(a.value) > price) return "amount above the price"; // exact scheme: never take more than quoted
  return null;
}

export function requirementsFor(
  resource: string,
  price: Atomic,
  seller: { payTo: string; network: string; asset: string },
  description: string,
  maxTimeoutSeconds: number,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: seller.network,
    maxAmountRequired: formatAtomic(price),
    resource,
    description,
    mimeType: "application/json",
    payTo: seller.payTo,
    maxTimeoutSeconds,
    asset: seller.asset,
    extra: { name: "USD Coin", version: "2" },
  };
}

export class X402Error extends Error {}
