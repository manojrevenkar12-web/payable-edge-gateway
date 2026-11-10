export interface Tally {
  sales: number;
  revenue: string; // atomic USDC
}

/** The shape of GET /__admin/report from the gateway. */
export interface SalesReport {
  seller: string;
  sales: number;
  revenue: string;
  byOperator: Record<string, Tally>;
  byRule: Record<string, Tally>;
  counters: Record<string, number>;
  reconciliation?: { book: { sales: number; total: string }; chain: { count: number; total: string }; matches: boolean };
}

export type Source = { kind: "snapshot" } | { kind: "live"; token: string };

export type ReportState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: SalesReport };
