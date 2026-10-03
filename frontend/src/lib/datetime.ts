/**
 * Canonical date/time display for the whole app — Indian Standard Time
 * (Asia/Kolkata), en-IN locale, 12-hour am/pm. Every user-visible
 * timestamp MUST render through these helpers; never call toLocale*
 * directly (browser-local timezone leaks in otherwise).
 */

export const IST = 'Asia/Kolkata';

const T12 = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true,
});
const DAY_MON = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST, day: 'numeric', month: 'short',
});
const DAY_MON_YEAR = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST, day: 'numeric', month: 'long', year: 'numeric',
});
const DT12 = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST, day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: true,
});
const DAY_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
});

export function parseIso(iso: string | Date | null | undefined): Date | null {
  if (iso == null) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** "02:30 pm" */
export function fmtTimeIST(iso: string | Date | null | undefined): string {
  const d = parseIso(iso);
  return d ? T12.format(d) : '—';
}

/** "3 Oct" */
export function fmtDateIST(iso: string | Date | null | undefined): string {
  const d = parseIso(iso);
  return d ? DAY_MON.format(d) : '—';
}

/** "3 October 2026" */
export function fmtDateLongIST(iso: string | Date | null | undefined): string {
  const d = parseIso(iso);
  return d ? DAY_MON_YEAR.format(d) : '—';
}

/** "3 Oct, 02:30 pm" */
export function fmtDateTimeIST(iso: string | Date | null | undefined): string {
  const d = parseIso(iso);
  return d ? DT12.format(d) : '—';
}

/** IST calendar day key "YYYY-MM-DD" — for comparisons/filters, not display. */
export function istDateKey(d: Date = new Date()): string {
  return DAY_KEY.format(d);
}

/** Same calendar day in IST — NOT the same UTC day or browser-local day. */
export function isSameISTDay(a: Date, b: Date = new Date()): boolean {
  return DAY_KEY.format(a) === DAY_KEY.format(b);
}

/** IST day key shifted by `offset` days (no DST in IST — safe arithmetic). */
export function istDateKeyOffset(offset: number, d: Date = new Date()): string {
  return istDateKey(new Date(d.getTime() + offset * 86400000));
}
