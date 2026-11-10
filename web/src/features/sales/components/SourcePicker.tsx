import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { color, font, layout, size, space } from "../../../shared/theme/tokens";
import type { Source } from "../data/types";

export function SourcePicker({ source, onChange }: { source: Source; onChange: (s: Source) => void }) {
  const [token, setToken] = useState(source.kind === "live" ? source.token : "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim()) onChange({ kind: "live", token: token.trim() });
      }}
      style={{ display: "flex", flexWrap: "wrap", gap: space.s, alignItems: "center", fontSize: size.small, color: color.muted }}
    >
      <span>{source.kind === "live" ? "Reading the running gateway." : "Showing the last simulation run."}</span>
      <label htmlFor="admin-token" style={{ marginLeft: "auto" }}>
        Admin token
      </label>
      <input
        id="admin-token"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        style={{ fontFamily: font.family, fontSize: size.small, padding: `${space.xs}px ${space.s}px`, border: `1px solid ${color.rule}`, borderRadius: layout.radius, background: color.surface }}
      />
      <Button type="submit" quiet>
        Read live gateway
      </Button>
      {source.kind === "live" && (
        <Button type="button" quiet onClick={() => onChange({ kind: "snapshot" })}>
          Show simulation
        </Button>
      )}
    </form>
  );
}
