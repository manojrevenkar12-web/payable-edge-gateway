import { animate, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { count, formatUsdc } from "../../../shared/format/money";
import { color, font, layout, leading, motion as m, size, space, weight } from "../../../shared/theme/tokens";
import type { SalesReport } from "../data/types";

/** The one figure that matters, counted in once, then the proof underneath: the seller's book against the chain. */
export function Reconciliation({ report }: { report: SalesReport }) {
  const reduce = useReducedMotion();
  const final = formatUsdc(report.revenue);
  const [shown, setShown] = useState(reduce ? final : formatUsdc("0"));

  useEffect(() => {
    if (reduce) return setShown(final);
    const target = Number(BigInt(report.revenue) / 10_000n); // cents, for drawing only
    const c = animate(0, target, {
      duration: m.countSeconds,
      ease: m.ease,
      onUpdate: (v) => setShown(formatUsdc(String(Math.round(v) * 10_000))),
      onComplete: () => setShown(final),
    });
    return () => c.stop();
  }, [report.revenue, reduce, final]);

  const rec = report.reconciliation;
  const differs = rec && !rec.matches;
  return (
    <header style={{ paddingTop: space.xl }}>
      <p style={{ fontSize: size.lead, color: color.muted, margin: 0, maxWidth: layout.measure }}>
        AI agents paid {report.seller} for {count(report.sales)} requests
      </p>
      <p
        aria-label={`${final} USDC`}
        style={{ fontSize: `clamp(${size.figureCompact}px, 8vw, ${size.figure * 1.6}px)`, fontWeight: weight.bold, lineHeight: leading.tight, margin: `${space.s}px 0 0`, fontVariantNumeric: font.numerals, color: color.ink }}
      >
        {shown} <span style={{ fontSize: size.heading, fontWeight: weight.medium, color: color.muted }}>USDC</span>
      </p>

      {rec && (
        <motion.dl
          initial={reduce ? false : { opacity: 0, y: space.s }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduce ? 0 : m.countSeconds, duration: m.settleSeconds, ease: m.ease }}
          className="rec-grid"
          style={{ marginTop: space.l }}
        >
          <Figure label="Recorded in the seller book" value={rec.book.total} n={rec.book.sales} />
          <Figure label="Settled on the chain" value={rec.chain.total} n={rec.chain.count} />
          <div>
            <dt style={{ color: color.muted, fontSize: size.small }}>Reconciliation</dt>
            <dd style={{ margin: 0, fontWeight: weight.bold, color: differs ? color.refused : color.agree }}>
              {differs
                ? `Differs by ${formatUsdc((BigInt(rec.chain.total) - BigInt(rec.book.total)).toString(), 6, 6)} USDC`
                : "Agrees to the last micro-USDC"}
            </dd>
          </div>
        </motion.dl>
      )}
    </header>
  );
}



function Figure({ label, value, n }: { label: string; value: string; n: number }) {
  return (
    <div>
      <dt style={{ color: color.muted, fontSize: size.small }}>{label}</dt>
      <dd style={{ margin: 0, fontVariantNumeric: font.numerals, color: color.ink }}>
        {formatUsdc(value, 6, 6)} <span style={{ color: color.muted }}>in {count(n)} payments</span>
      </dd>
    </div>
  );
}
