import { useState } from "react";
import { count } from "../../shared/format/money";
import { color, font, layout, space, weight } from "../../shared/theme/tokens";
import { Button } from "../../shared/ui/Button";
import { Notice } from "../../shared/ui/Notice";
import { Section } from "../../shared/ui/Section";
import { Reconciliation } from "./components/Reconciliation";
import { RefusalList } from "./components/RefusalList";
import { SalesSkeleton } from "./components/SalesSkeleton";
import { ShareBars } from "./components/ShareBars";
import { SourcePicker } from "./components/SourcePicker";
import { fetchReport } from "./data/fetchReport";
import { deliveredFree, refusalsFrom } from "./data/refusals";
import type { SalesReport, Source } from "./data/types";
import { useReport } from "./data/useReport";

const RULE_NAMES: Record<string, string> = {
  articles: "Articles",
  "search-api": "Search API",
  "resolve-ticket": "Resolved support tickets (paid on outcome)",
};

export function SalesPage({ load = fetchReport }: { load?: typeof fetchReport }) {
  const [source, setSource] = useState<Source>({ kind: "snapshot" });
  const { state, retry } = useReport(source, load);

  return (
    <main style={{ maxWidth: layout.maxWidth, margin: "0 auto", padding: `${space.l}px ${space.l}px ${space.xxl}px` }}>
      <SourcePicker source={source} onChange={setSource} />
      {state.status === "loading" && <SalesSkeleton />}
      {state.status === "error" && (
        <div style={{ marginTop: space.xl }}>
          <Notice tone="error" title="The sales report did not load" action={<Button onClick={retry}>Try again</Button>}>
            {state.message}
          </Notice>
        </div>
      )}
      {state.status === "ready" && state.report.sales === 0 && (
        <div style={{ marginTop: space.xl }}>
          <Notice tone="empty" title="No agent has paid yet">
            Prices are live. The first paid request will show here with who paid, for what, and the matching settlement on the
            chain. Run <code>npm run sim</code> to send simulated agent traffic.
          </Notice>
        </div>
      )}
      {state.status === "ready" && state.report.sales > 0 && <Report report={state.report} />}
    </main>
  );
}

function Report({ report }: { report: SalesReport }) {
  const free = deliveredFree(report.counters);
  return (
    <>
      <Reconciliation report={report} />
      <Section title="Who paid" note="Revenue by the agent operator that signed the request. Unverified callers pay the higher price.">
        <ShareBars rows={report.byOperator} total={report.revenue} nameFor={(k) => (k === "unverified" ? "Unverified callers" : k)} />
      </Section>
      <Section title="What they paid for">
        <ShareBars rows={report.byRule} total={report.revenue} nameFor={(k) => RULE_NAMES[k] ?? k} />
      </Section>
      <Section
        title="Served without a charge"
        note="These requests were answered and nobody was charged, by design."
      >
        <dl className="free-grid">
          <Fact n={free.redelivered} text="Retries of a paid request, delivered again within five minutes" />
          <Fact n={free.outcomeNotMet} text="Tickets the service could not resolve, so the agent kept its money" />
          <Fact n={free.partner} text="Pages read by the search partner the seller lets in for free" />
        </dl>
      </Section>
      <Section title="What the gateway turned away" note="Each of these was refused before any money moved.">
        <RefusalList rows={refusalsFrom(report.counters)} />
      </Section>
    </>
  );
}

function Fact({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ borderTop: `1px solid ${color.rule}`, paddingTop: space.s }}>
      <dt style={{ fontVariantNumeric: font.numerals, fontWeight: weight.bold, color: color.ink }}>{count(n)}</dt>
      <dd style={{ margin: 0, color: color.muted }}>{text}</dd>
    </div>
  );
}
