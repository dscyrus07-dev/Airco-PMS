import { useEffect, useRef } from 'react';
import { perfLog } from '../dev/perf';

/**
 * Shared polling coordinator — replaces ad-hoc setInterval polling.
 *
 * Behavior:
 *  - ticks every `intervalMs` while `enabled` and the tab is visible
 *  - pauses while the document is hidden (visibilitychange listener)
 *  - never overlaps: a tick is skipped while the previous callback is
 *    still in flight (prevents request multiplication on slow requests)
 *  - fires once on visibility restore so a returning tab sees fresh data
 *    immediately instead of waiting out a full interval
 *
 * The hook owns only the timer — the component keeps its mount-scoped
 * initial load, so nothing polls for an unmounted view.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
  name = 'unknown',
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const tick = async (reason: string) => {
      if (document.visibilityState !== 'visible') {
        perfLog(`[POLL] component=${name} reason=${reason} SKIPPED:hidden`);
        return;
      }
      if (inFlight.current) {
        perfLog(`[POLL] component=${name} reason=${reason} SKIPPED:in-flight`);
        return;
      }
      inFlight.current = true;
      perfLog(`[POLL] component=${name} reason=${reason} request=1`);
      try {
        await cbRef.current();
      } finally {
        inFlight.current = false;
      }
    };
    const timer = window.setInterval(() => void tick('interval'), intervalMs);
    const onVisible = () => void tick('visibility-restore');
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, enabled, name]);
}
