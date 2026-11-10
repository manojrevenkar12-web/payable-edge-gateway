import type { SalesReport, Source } from "./types";

const SNAPSHOT_URL = "/sample-report.json";
const LIVE_URL = "/__admin/report";

export class ReportError extends Error {}

export async function fetchReport(source: Source, signal?: AbortSignal): Promise<SalesReport> {
  const res = await fetch(source.kind === "live" ? LIVE_URL : SNAPSHOT_URL, {
    signal,
    headers: source.kind === "live" ? { authorization: `Bearer ${source.token}` } : undefined,
  }).catch(() => {
    throw new ReportError(
      source.kind === "live" ? "The gateway did not answer. Start it with `npx wrangler dev` and try again." : "The snapshot could not be loaded.",
    );
  });
  if (res.status === 401) throw new ReportError("The gateway refused the admin token. Check ADMIN_TOKEN and try again.");
  if (!res.ok) throw new ReportError(`The gateway answered ${res.status}. Try again in a moment.`);
  const body = (await res.json()) as SalesReport;
  if (typeof body.revenue !== "string" || typeof body.byOperator !== "object") throw new ReportError("The report is not in the expected shape.");
  return body;
}
