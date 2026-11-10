/** Every colour, size, space and timing the console uses. Components read these; none hard-codes its own. */
export const color = {
  paper: "#EDF0EE",
  surface: "#F7F9F8",
  ink: "#17201C",
  muted: "#56625C",
  rule: "#C9D1CC",
  paid: "#1F4E79",
  paidSoft: "#D5E0EA",
  refused: "#A33A2B",
  refusedSoft: "#F0DCD8",
  agree: "#2E6B4A",
  skeleton: "#DCE2DE",
} as const;

export const font = {
  family: '"Schibsted Grotesk Variable", system-ui, sans-serif',
  numerals: "tabular-nums lining-nums",
} as const;

/** a 1.25 modular scale from a 16px body */
export const size = {
  small: 13,
  body: 16,
  lead: 20,
  heading: 25,
  figure: 49,
  figureCompact: 34,
} as const;

export const weight = { regular: 400, medium: 520, bold: 700 } as const;
export const leading = { tight: 1.1, body: 1.5 } as const;

export const space = { xs: 4, s: 8, m: 16, l: 24, xl: 40, xxl: 64 } as const;

export const layout = {
  maxWidth: 1040,
  measure: "68ch",
  barHeight: 10,
  radius: 3,
  narrow: 720,
} as const;

export const motion = {
  countSeconds: 1.1,
  settleSeconds: 0.35,
  barSeconds: 0.6,
  stagger: 0.06,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
} as const;

export const skeletonRows = { operators: 5, rules: 3, refusals: 6 } as const;
