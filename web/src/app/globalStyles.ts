import { color, font, layout, leading, size, space } from "../shared/theme/tokens";

/** The few rules that need CSS (focus, media queries, the skeleton pulse); everything else is inline from tokens. */
export function applyGlobalStyles() {
  const css = `
    body { margin: 0; background: ${color.paper}; color: ${color.ink}; font-family: ${font.family}; font-size: ${size.body}px; line-height: ${leading.body}; }
    :focus-visible { outline: 2px solid ${color.paid}; outline-offset: 2px; }
    code { font-family: inherit; font-weight: 600; }
    .share-row { display: grid; grid-template-columns: minmax(10rem, 1.2fr) 2fr minmax(9rem, auto); gap: ${space.m}px; align-items: center; }
    .rec-grid { display: grid; grid-template-columns: auto auto 1fr; column-gap: ${space.xl}px; row-gap: ${space.m}px; align-items: baseline; }
    .free-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: ${space.l}px; margin: 0; }
    @media (max-width: ${layout.narrow}px) {
      .share-row { grid-template-columns: 1fr auto; }
      .share-row > :nth-child(2) { grid-column: 1 / -1; grid-row: 2; }
      .free-grid, .rec-grid { grid-template-columns: 1fr; }
    }
    @keyframes pulse { 50% { opacity: .55; } }
    .pulse { animation: pulse 1.4s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
  `;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}
