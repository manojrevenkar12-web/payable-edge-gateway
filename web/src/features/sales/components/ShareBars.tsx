import { motion, useReducedMotion } from "framer-motion";
import { count, formatUsdc, shareOf } from "../../../shared/format/money";
import { color, font, layout, motion as m, size, space, weight } from "../../../shared/theme/tokens";
import type { Tally } from "../data/types";

/** Rows of name, bar and amount, sorted by revenue. Used for operators and for priced routes. */
export function ShareBars({ rows, total, nameFor }: { rows: Record<string, Tally>; total: string; nameFor?: (k: string) => string }) {
  const reduce = useReducedMotion();
  const sorted = Object.entries(rows).sort(([, a], [, b]) => (BigInt(b.revenue) > BigInt(a.revenue) ? 1 : -1));
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {sorted.map(([k, t], i) => (
        <li key={k} className="share-row" style={{ padding: `${space.s}px 0`, borderTop: `1px solid ${color.rule}` }}>
          <span style={{ fontWeight: weight.medium, color: color.ink }}>{nameFor ? nameFor(k) : k}</span>
          <span aria-hidden style={{ background: color.paidSoft, height: layout.barHeight, borderRadius: layout.radius, overflow: "hidden" }}>
            <motion.span
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: shareOf(t.revenue, total) }}
              transition={{ duration: m.barSeconds, ease: m.ease, delay: reduce ? 0 : m.countSeconds + i * m.stagger }}
              style={{ display: "block", height: "100%", background: color.paid, transformOrigin: "left" }}
            />
          </span>
          <span style={{ fontVariantNumeric: font.numerals, textAlign: "right", color: color.ink }}>
            {formatUsdc(t.revenue)} <span style={{ color: color.muted, fontSize: size.small }}>{count(t.sales)} sales</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
