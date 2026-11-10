import { useCallback, useEffect, useState } from "react";
import { fetchReport, ReportError } from "./fetchReport";
import type { ReportState, Source } from "./types";

export function useReport(source: Source, load = fetchReport) {
  const [state, setState] = useState<ReportState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = source.kind === "live" ? `live:${source.token}` : "snapshot";

  useEffect(() => {
    const ctl = new AbortController();
    setState({ status: "loading" });
    load(source, ctl.signal)
      .then((report) => setState({ status: "ready", report }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setState({ status: "error", message: e instanceof ReportError ? e.message : "Something went wrong reading the report." });
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, load]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
