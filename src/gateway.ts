/**
 * The request path. In order: who is calling (Web Bot Auth), what this costs them (pricing), have they paid
 * (x402), reserve the payment in the payer's ledger, verify it with the facilitator, call the origin, settle only
 * if the price's condition was met, record the sale. Every refusal says why.
 */

import type { Env } from "./env";
import { demoOrigin } from "./origin";
import { type Decision, decide, outcomeMet, pricing } from "./pricing";
import { parseAtomic } from "./money";
import { addressOf } from "./simcrypto";
import { type BotIdentity, type DirectoryResolver, type Jwk, verifyRequest } from "./webbotauth";
import {
  decodePayment,
  encodePaymentResponse,
  type Facilitator,
  HttpFacilitator,
  matchesRequirements,
  type PaymentPayload,
  type PaymentRequirements,
  paymentRequired,
  requirementsFor,
  X402Error,
} from "./x402";

export interface Clock {
  ms(): number;
}

const systemClock: Clock = { ms: () => Date.now() };

/** Key directories: fetched over HTTPS and cached per isolate; in SIM mode read from SimRegistry. */
export class Directories implements DirectoryResolver {
  private cache = new Map<string, { keys: Jwk[]; until: number }>();
  constructor(
    private env: Env,
    private clock: Clock,
  ) {}
  async keys(agent: string): Promise<Jwk[]> {
    const host = new URL(agent).host.toLowerCase();
    const hit = this.cache.get(host);
    if (hit && hit.until > this.clock.ms()) return hit.keys;
    let keys: Jwk[];
    if (this.env.SIM === "1" && host.endsWith(".agents.sim")) {
      keys = await this.env.SIM_REGISTRY.get(this.env.SIM_REGISTRY.idFromName("registry")).keys(host);
    } else {
      const r = await fetch(new URL("/.well-known/http-message-signatures-directory", agent));
      if (!r.ok) throw new Error(`key directory answered ${r.status}`);
      keys = ((await r.json()) as { keys: Jwk[] }).keys;
    }
    this.cache.set(host, { keys, until: this.clock.ms() + pricing.limits.keyDirectoryCacheSeconds * 1000 });
    return keys;
  }
}

class SimFacilitator implements Facilitator {
  constructor(
    private env: Env,
    private clock: Clock,
  ) {}
  private chain() {
    return this.env.SIM_CHAIN.get(this.env.SIM_CHAIN.idFromName("chain"));
  }
  verify(p: PaymentPayload, r: PaymentRequirements) {
    return this.chain().verify(p, r, Math.floor(this.clock.ms() / 1000));
  }
  settle(p: PaymentPayload, r: PaymentRequirements) {
    return this.chain().settle(p, r, Math.floor(this.clock.ms() / 1000));
  }
}

export class Gateway {
  readonly directories: Directories;
  readonly facilitator: Facilitator;
  constructor(
    private env: Env,
    private clock: Clock = systemClock,
    facilitator?: Facilitator,
  ) {
    this.directories = new Directories(env, clock);
    this.facilitator =
      facilitator ?? (env.SIM === "1" ? new SimFacilitator(env, clock) : new HttpFacilitator(env.FACILITATOR_URL ?? ""));
  }

  private book() {
    return this.env.SELLER_BOOK.get(this.env.SELLER_BOOK.idFromName(pricing.seller.id));
  }

  private origin(req: Request): Promise<Response> {
    if (this.env.SIM === "1") return Promise.resolve(demoOrigin(req));
    const url = new URL(req.url);
    return fetch(new URL(url.pathname + url.search, this.env.ORIGIN_URL), req);
  }

  private refuse(ctx: ExecutionContext, status: number, reason: string, extra: Record<string, unknown> = {}): Response {
    ctx.waitUntil(this.book().count(`refused:${reason}`));
    return new Response(JSON.stringify({ error: reason, ...extra }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  async handle(req: Request, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const now = this.clock.ms();
    const who: BotIdentity = await verifyRequest(req, this.directories, {
      now: Math.floor(now / 1000),
      maxValiditySeconds: pricing.limits.signatureMaxValiditySeconds,
      clockSkewSeconds: pricing.limits.clockSkewSeconds,
    });
    if (who.kind === "invalid") return this.refuse(ctx, 401, "bot signature rejected", { reason: who.reason });
    const decision: Decision = decide(url.pathname, who);
    if (decision.kind === "block") return this.refuse(ctx, 403, "blocked", { reason: decision.reason });
    const operator = who.kind === "verified" ? who.operator : "unverified";
    if (decision.kind === "free") {
      ctx.waitUntil(this.book().count(`free:${decision.rule.id}`));
      return this.origin(req);
    }

    const resource = `${url.origin}${url.pathname}${url.search}`;
    const requirements = requirementsFor(
      resource,
      decision.price,
      pricing.seller,
      decision.rule.description ?? decision.rule.id,
      pricing.limits.maxTimeoutSeconds,
    );
    const header = req.headers.get("x-payment");
    if (!header) {
      ctx.waitUntil(this.book().count(`quoted:${decision.rule.id}`));
      return paymentRequired([requirements], "X-PAYMENT header is required");
    }
    let payment: PaymentPayload;
    try {
      payment = decodePayment(header);
    } catch (e) {
      ctx.waitUntil(this.book().count("refused:malformed payment"));
      return paymentRequired([requirements], e instanceof X402Error ? e.message : "malformed payment");
    }
    const mismatch = matchesRequirements(payment, requirements, decision.price);
    if (mismatch) {
      ctx.waitUntil(this.book().count(`refused:${mismatch}`));
      return paymentRequired([requirements], mismatch);
    }
    const a = payment.payload.authorization;
    if (payment.payload.publicKey && (await addressOf(payment.payload.publicKey)) !== a.from.toLowerCase()) {
      ctx.waitUntil(this.book().count("refused:key is not the payer's"));
      return paymentRequired([requirements], "key is not the payer's");
    }
    const ledger = this.env.PAYER_LEDGER.get(this.env.PAYER_LEDGER.idFromName(a.from.toLowerCase()));
    const reserved = await ledger.reserve({
      nonce: a.nonce,
      amount: a.value,
      resource,
      requestId: req.headers.get("cf-ray") ?? crypto.randomUUID(),
      now,
      leaseMs: pricing.limits.maxTimeoutSeconds * 1000,
      redeliverMs: pricing.limits.deliveryRetrySeconds * 1000,
      capAmount: parseAtomic(pricing.limits.payerSpendCap.amount),
      capWindowMs: pricing.limits.payerSpendCap.windowSeconds * 1000,
    });
    if (!reserved.ok) {
      ctx.waitUntil(this.book().count(`refused:${reserved.reason}`));
      return paymentRequired([requirements], reserved.reason);
    }
    if (reserved.mode === "redeliver") {
      ctx.waitUntil(this.book().count("redelivered"));
      return withPaymentResponse(await this.origin(req), {
        success: true,
        transaction: reserved.tx,
        network: payment.network,
        payer: a.from.toLowerCase(),
        redelivery: true,
      });
    }

    const verified = await this.facilitator.verify(payment, requirements);
    if (!verified.isValid) {
      await ledger.release(a.nonce, verified.invalidReason ?? "invalid");
      ctx.waitUntil(this.book().count(`refused:${verified.invalidReason ?? "invalid"}`));
      return paymentRequired([requirements], verified.invalidReason ?? "payment invalid");
    }

    const res = await this.origin(req);
    const delivered = decision.onOutcome ? outcomeMet(decision.rule, res) : res.status >= 200 && res.status <= 299;
    if (!delivered) {
      await ledger.release(a.nonce, decision.onOutcome ? "outcome not met" : `origin ${res.status}`);
      ctx.waitUntil(this.book().count(decision.onOutcome ? "not charged:outcome not met" : "not charged:origin failed"));
      return withPaymentResponse(res, {
        success: false,
        errorReason: decision.onOutcome ? "outcome_not_met" : "not_delivered",
        network: payment.network,
        payer: a.from.toLowerCase(),
      });
    }

    const settled = await this.facilitator.settle(payment, requirements);
    if (!settled.success) {
      await ledger.release(a.nonce, settled.errorReason ?? "settlement failed");
      ctx.waitUntil(this.book().count(`refused:settlement ${settled.errorReason ?? "failed"}`));
      return paymentRequired([requirements], `settlement failed: ${settled.errorReason ?? "unknown"}`);
    }
    await ledger.commit(a.nonce, settled.transaction, this.clock.ms());
    ctx.waitUntil(
      this.book().recordSale({
        tx: settled.transaction,
        at: now,
        operator,
        rule: decision.rule.id,
        amount: a.value,
        payer: a.from.toLowerCase(),
      }),
    );
    return withPaymentResponse(res, { ...settled, payer: a.from.toLowerCase() });
  }
}

function withPaymentResponse(res: Response, body: Record<string, unknown>): Response {
  const out = new Response(res.body, res);
  out.headers.set("x-payment-response", encodePaymentResponse(body));
  out.headers.set("access-control-expose-headers", "x-payment-response");
  return out;
}
