import type { ReactNode } from "react";
import { color, size, space, weight } from "../theme/tokens";

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: space.xxl }}>
      <h2 style={{ fontSize: size.heading, fontWeight: weight.bold, margin: 0, color: color.ink }}>{title}</h2>
      {note && <p style={{ color: color.muted, margin: `${space.xs}px 0 ${space.l}px`, maxWidth: "62ch" }}>{note}</p>}
      {children}
    </section>
  );
}
