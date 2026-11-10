import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SalesPage } from "../src/features/sales/SalesPage";
import { ReportError } from "../src/features/sales/data/fetchReport";
import type { SalesReport } from "../src/features/sales/data/types";
import { formatUsdc } from "../src/shared/format/money";

const report: SalesReport = {
  seller: "harbour-news",
  sales: 3,
  revenue: "995000",
  byOperator: { "crawler-a.agents.sim": { sales: 2, revenue: "990000" }, unverified: { sales: 1, revenue: "5000" } },
  byRule: { articles: { sales: 2, revenue: "5000" }, "resolve-ticket": { sales: 1, revenue: "990000" } },
  counters: { "refused:payment already used": 4, redelivered: 2 },
  reconciliation: { book: { sales: 3, total: "995000" }, chain: { count: 3, total: "995000" }, matches: true },
};

describe("sales console", () => {
  it("shows a skeleton, then the report with the reconciliation", async () => {
    render(<SalesPage load={async () => report} />);
    expect(screen.getByLabelText("Loading the sales report")).toBeTruthy();
    await screen.findByText("Agrees to the last micro-USDC");
    expect(screen.getByText("Payment reused for a different page")).toBeTruthy();
    expect(screen.getByText("Unverified callers")).toBeTruthy();
  });

  it("says plainly when the book and the chain differ", async () => {
    const off = { ...report, reconciliation: { ...report.reconciliation!, chain: { count: 3, total: "1000000" }, matches: false } };
    render(<SalesPage load={async () => off} />);
    await screen.findByText("Differs by 0.005000 USDC");
  });

  it("explains an error and retries", async () => {
    const load = vi.fn().mockRejectedValueOnce(new ReportError("The gateway did not answer.")).mockResolvedValue(report);
    render(<SalesPage load={load} />);
    await screen.findByText("The gateway did not answer.");
    fireEvent.click(screen.getByText("Try again"));
    await screen.findByText("Agrees to the last micro-USDC");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("has an empty state before the first sale", async () => {
    render(<SalesPage load={async () => ({ ...report, sales: 0, revenue: "0", byOperator: {}, byRule: {}, counters: {} })} />);
    await screen.findByText("No agent has paid yet");
  });

  it("formats atomic USDC without floats", () => {
    expect(formatUsdc("370565000")).toBe("370.56");
    expect(formatUsdc("1234567890123456789", 6, 6)).toBe("1,234,567,890,123.456789");
    expect(formatUsdc("5")).toBe("0.00");
  });
});
