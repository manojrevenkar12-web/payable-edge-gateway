import type { Env } from "./env";
import { Gateway } from "./gateway";
import { pricing } from "./pricing";
import type { Jwk } from "./webbotauth";

export { PayerLedger } from "./ledger";
export { SellerBook } from "./seller";
export { SimChain, SimRegistry } from "./sim";

/** The seller's API: revenue, refusals and reconciliation; in SIM mode also funding and key registration. */
async function admin(req: Request, env: Env): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
    return new Response(JSON.stringify({ error: "admin token required" }), { status: 401 });
  }
  const url = new URL(req.url);
  const book = env.SELLER_BOOK.get(env.SELLER_BOOK.idFromName(pricing.seller.id));
  if (url.pathname === "/__admin/report") {
    const report = await book.report();
    const body: Record<string, unknown> = { seller: pricing.seller.id, ...report };
    if (env.SIM === "1") {
      const chain = env.SIM_CHAIN.get(env.SIM_CHAIN.idFromName("chain"));
      const received = await chain.received(pricing.seller.payTo);
      body.reconciliation = {
        book: { sales: report.sales, total: report.revenue },
        chain: received,
        matches: received.count === report.sales && received.total === report.revenue,
      };
    }
    return Response.json(body);
  }
  if (env.SIM === "1" && req.method === "POST" && url.pathname === "/__admin/sim/fund") {
    const { address, amount } = (await req.json()) as { address: string; amount: string };
    await env.SIM_CHAIN.get(env.SIM_CHAIN.idFromName("chain")).fund(address, amount);
    return Response.json({ ok: true });
  }
  if (env.SIM === "1" && req.method === "POST" && url.pathname === "/__admin/sim/register") {
    const { host, keys } = (await req.json()) as { host: string; keys: Jwk[] };
    await env.SIM_REGISTRY.get(env.SIM_REGISTRY.idFromName("registry")).put(host, keys);
    return Response.json({ ok: true });
  }
  if (env.SIM === "1" && url.pathname === "/__admin/sim/payer") {
    const address = url.searchParams.get("address") ?? "";
    const ledger = env.PAYER_LEDGER.get(env.PAYER_LEDGER.idFromName(address.toLowerCase()));
    const chain = env.SIM_CHAIN.get(env.SIM_CHAIN.idFromName("chain"));
    return Response.json({ ledger: await ledger.summary(), balance: await chain.balanceOf(address) });
  }
  return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(req.url).pathname.startsWith("/__admin/")) return admin(req, env);
    return new Gateway(env).handle(req, ctx);
  },
} satisfies ExportedHandler<Env>;
