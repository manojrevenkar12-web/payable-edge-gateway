import type { ButtonHTMLAttributes } from "react";
import { color, font, layout, size, space, weight } from "../theme/tokens";

export function Button({ quiet, style, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { quiet?: boolean }) {
  return (
    <button
      {...rest}
      style={{
        fontFamily: font.family,
        fontSize: size.body,
        fontWeight: weight.medium,
        padding: `${space.s}px ${space.m}px`,
        borderRadius: layout.radius,
        border: `1px solid ${quiet ? color.rule : color.paid}`,
        background: quiet ? "transparent" : color.paid,
        color: quiet ? color.ink : color.surface,
        cursor: "pointer",
        ...style,
      }}
    />
  );
}
