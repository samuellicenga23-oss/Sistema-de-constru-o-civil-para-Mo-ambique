import { useEffect, useState } from "react";
import { DATA_SAVER_CHANGE_EVENT, getPollingInterval } from "../lib/dataSaver";

/** Reage à preferência dataSaver para intervalos de polling dinâmicos. */
export function useDataSaverPollingInterval(baseMs: number): number {
  const [intervalMs, setIntervalMs] = useState(() => getPollingInterval(baseMs));

  useEffect(() => {
    function refresh() {
      setIntervalMs(getPollingInterval(baseMs));
    }
    refresh();
    window.addEventListener(DATA_SAVER_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(DATA_SAVER_CHANGE_EVENT, refresh);
  }, [baseMs]);

  return intervalMs;
}
