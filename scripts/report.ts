/**
 * Writes the dashboard in README.md (between the markers) and the console's snapshot from the generated reports.
 * Nothing in the dashboard is typed by hand.
 *
 *   npm run report
 */

import { readFileSync, writeFileSync } from "node:fs";

const sim = JSON.parse(readFileSync("reports/sim.json", "utf8"));
const tests = JSON.parse(readFileSync("reports/tests.json", "utf8"));
const webTests = JSON.parse(readFileSync("reports/web-tests.json", "utf8"));

const usdc = (atomic: string, shown = 6) => {
  const d = atomic.padStart(7, "0");
  return `${d.slice(0, -6).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${d.slice(-6).slice(0, shown)}`;
};
const n = (x: number) => x.toLocaleString("en-GB");
const k = sim.by_kind as Record<string, { tasks: number; correct: number; attack: boolean }>;
const row = (id: string, what: string) => `| ${what} | ${n(k[id].tasks)} | ${n(k[id].correct)} |`;
const u = sim.latency_unloaded_ms;
const c = sim.seller_report.counters as Record<string, number>;

const dashboard = `| | |
|---|---|
| Simulated agent tasks, all checked | **${n(sim.tasks)}** (~${n(sim.http_requests_approx)} HTTP requests, ${sim.concurrency} at a time) |
| Gateway did what it should | **${n(sim.correct)} of ${n(sim.tasks)}** |
| Attacks refused or contained | **${n(sim.attacks.refused_or_contained)} of ${n(sim.attacks.tasks)}** |
| Wallets whose balance is exactly what they should have paid | **${sim.wallets.checked - sim.wallets.mismatched} of ${sim.wallets.checked}** |
| Revenue the simulator expected / seller book / chain | **${usdc(sim.expected_revenue)} / ${usdc(sim.book_revenue)} / ${usdc(sim.chain_revenue)} USDC** |
| Spending cap held against an agent draining one wallet | **${sim.spending_cap.held ? "yes" : "NO"}**: stopped at ${usdc((BigInt(sim.spending_cap.wallet_spend_before_drain) + BigInt(sim.spending_cap.drained_in_window)).toString(), 2)} of a ${usdc(sim.spending_cap.cap, 2)} USDC daily cap |
| Payment overhead, one request at a time, p50 | **${u.payment_overhead_p50} ms** (free ${u.free_route.p50} ms, paid ${u.paid_request.p50} ms, paid p99 ${u.paid_request.p99} ms) |
| Tests | **${tests.numPassedTests} of ${tests.numTotalTests}** in workerd, **${webTests.numPassedTests} of ${webTests.numTotalTests}** in the console |

| Traffic | Tasks | Handled as intended |
|---|---:|---:|
${row("article", "Verified agent pays for an article")}
${row("search", "Verified agent pays for a search call")}
${row("resolve", "Agent pays only if the ticket is resolved")}
${row("partner", "Search partner reads for free")}
${row("unverified_article", "Unverified caller pays the higher price")}
${row("retry_redelivery", "Retry of a paid request is delivered again, no second charge")}
${row("replay_other_resource", "Attack: replay a used payment for another page")}
${row("double_spend_burst", "Attack: five copies of one payment at once")}
${row("underpay", "Attack: pay one micro-USDC less")}
${row("expired", "Attack: expired authorization")}
${row("stolen_key", "Attack: sign with another wallet's key")}
${row("broke", "Attack: empty wallet")}
${row("forged_bot", "Attack: agent whose keys were never published")}
${row("tampered_agent", "Attack: change the Signature-Agent header after signing")}
${row("unverified_blocked", "Attack: unverified caller on a verified-only route")}

Served without charging: ${n(c.redelivered ?? 0)} retries delivered again, ${n(c["not charged:outcome not met"] ?? 0)} unresolved tickets, ${n(c["free:articles"] ?? 0)} partner reads.
Under load (${sim.concurrency} tasks at once) p50 is ${sim.latency_ms.paid_request.p50} ms paid and ${sim.latency_ms.free_route.p50} ms free, ${sim.tasks_per_second} tasks a second; with the simulator and the Worker sharing one machine those figures measure the machine, not the gateway.`;

const readme = readFileSync("README.md", "utf8");
const start = "<!-- dashboard:start -->";
const end = "<!-- dashboard:end -->";
const [head, rest] = readme.split(start);
const tail = rest.split(end)[1];
writeFileSync("README.md", `${head}${start}\n${dashboard}\n${end}${tail}`);
writeFileSync("web/public/sample-report.json", `${JSON.stringify(sim.seller_report, null, 1)}\n`);
console.log("README dashboard and web/public/sample-report.json written");
