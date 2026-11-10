import { count } from "../../../shared/format/money";
import { color, font, size, space, weight } from "../../../shared/theme/tokens";

export function RefusalList({ rows }: { rows: { key: string; label: string; count: number }[] }) {
  if (rows.length === 0) return <p style={{ color: color.muted }}>Nothing was refused in this period.</p>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: font.numerals }}>
      <thead>
        <tr style={{ color: color.muted, fontSize: size.small, textAlign: "left" }}>
          <th style={{ fontWeight: weight.regular, paddingBottom: space.s }}>Reason</th>
          <th style={{ fontWeight: weight.regular, paddingBottom: space.s, textAlign: "right" }}>Requests</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} style={{ borderTop: `1px solid ${color.rule}` }}>
            <td style={{ padding: `${space.s}px 0`, color: color.ink }}>{r.label}</td>
            <td style={{ padding: `${space.s}px 0`, textAlign: "right", color: color.refused, fontWeight: weight.medium }}>{count(r.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
