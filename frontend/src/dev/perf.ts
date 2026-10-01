/**
 * Dev-only performance instrumentation — Phase-1.1 investigation.
 *
 * Emits compact structured console lines (performance.now() based):
 *   [REQ] corr=m3 POST /tasks/x/start 138ms 200      — every apiFetch call
 *   [REFRESH] corr=m3 <mark> +Nms                    — refreshUnits phases
 *   [POLL] component=X reason=Y request=Z            — poll ticks
 *   [RENDER] commits=N actual=Ms base=Ms             — Profiler commits
 *   [DETAIL] task=<uid> reason=<deps>                — drawer detail fetches
 *
 * A mutation (non-GET request) opens a 2s correlation window — every
 * request while the window is open inherits that correlation id, so the
 * full request waterfall caused by one user action is attributable.
 * No production behavior: disabled outside import.meta.env.DEV.
 */

const ENABLED = import.meta.env.DEV;

let corrSeq = 0;
let currentCorr: string | null = null;
let corrUntil = 0;
const CORR_WINDOW_MS = 2_000;
const CORR_EXTEND_MS = 600;

export const perfEnabled = (): boolean => ENABLED;

export function perfLog(line: string): void {
  if (ENABLED) console.log(line);
}

/** Correlation id for a request about to be sent. Mutations open a window;
 *  requests inside the window inherit it and extend it slightly so the
 *  trailing refresh burst stays attributed to the mutation. */
export function corrForRequest(method: string): string {
  const now = performance.now();
  if (method !== 'GET') {
    currentCorr = `m${++corrSeq}`;
    corrUntil = now + CORR_WINDOW_MS;
    return currentCorr;
  }
  if (currentCorr !== null && now <= corrUntil) {
    corrUntil = now + CORR_EXTEND_MS;
    return currentCorr;
  }
  return '-';
}

export function reqLog(
  method: string, pathWithQuery: string, corr: string,
  durationMs: number, status: number | string,
): void {
  if (!ENABLED) return;
  const short = pathWithQuery.replace(/^.*\/api\/v\d+/, '');
  console.log(
    `[REQ] corr=${corr} ${method} ${short} ${durationMs.toFixed(0)}ms ${status}`
  );
}

/** Mark helper: returns a stamper bound to one action/refresh. */
export function marker(tag: string, corr: string) {
  const t0 = performance.now();
  let last = t0;
  return (label: string) => {
    if (!ENABLED) return;
    const now = performance.now();
    console.log(
      `[${tag}] corr=${corr} ${label} +${(now - last).toFixed(0)}ms (total ${(now - t0).toFixed(0)}ms)`
    );
    last = now;
  };
}
