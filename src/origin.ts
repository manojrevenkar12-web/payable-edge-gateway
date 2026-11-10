/**
 * The publisher behind the gateway. In production the gateway forwards to ORIGIN_URL; with SIM="1" it calls this
 * demo origin: articles, a search API, and a ticket-resolving agent that sometimes cannot resolve the ticket (that
 * is what an on_outcome price is for).
 */

export function demoOrigin(req: Request): Response {
  const url = new URL(req.url);
  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  if (url.pathname === "/") return json({ name: "Harbour News", paid: ["/articles/*", "/api/search", "/api/resolve"] });
  if (url.pathname.startsWith("/articles/")) {
    const slug = url.pathname.slice("/articles/".length);
    return json({ slug, title: `Harbour News: ${slug.replace(/-/g, " ")}`, words: 640 + slug.length * 7 });
  }
  if (url.pathname === "/api/search") {
    const q = url.searchParams.get("q") ?? "";
    return json({ q, results: [`/articles/${q || "harbour"}-1`, `/articles/${q || "harbour"}-2`] });
  }
  if (url.pathname === "/api/resolve") {
    const ticket = Number(url.searchParams.get("ticket") ?? "0");
    // deterministic: 1 in 7 tickets cannot be resolved, 1 in 50 hits an origin error
    if (ticket % 50 === 49) return json({ ticket, error: "origin unavailable" }, { status: 503 });
    const resolved = ticket % 7 !== 3;
    return json({ ticket, resolved }, { headers: { "x-outcome": resolved ? "resolved" : "unresolved" } });
  }
  return json({ error: "not found" }, { status: 404 });
}
