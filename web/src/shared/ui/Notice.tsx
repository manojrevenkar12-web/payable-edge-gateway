import type { ReactNode } from "react";
import { color, font, size, space, weight } from "../theme/tokens";

/** A full-width message for the error and empty states: what happened, and the one thing to do next. */
export function Notice({ tone, title, children, action }: { tone: "error" | "empty"; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section
      role={tone === "error" ? "alert" : "status"}
      style={{
        borderLeft: `3px solid ${tone === "error" ? color.refused : color.rule}`,
        padding: `${space.m}px ${space.l}px`,
        background: color.surface,
        fontFamily: font.family,
      }}
    >
      <h2 style={{ fontSize: size.lead, fontWeight: weight.bold, margin: 0, color: color.ink }}>{title}</h2>
      <div style={{ color: color.muted, marginTop: space.s, maxWidth: "60ch" }}>{children}</div>
      {action && <div style={{ marginTop: space.m }}>{action}</div>}
    </section>
  );
}
