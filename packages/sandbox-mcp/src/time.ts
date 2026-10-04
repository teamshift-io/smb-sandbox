/** Time helpers. All math is done in UTC; company-local dates use Intl. */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Offset (ms) of `timeZone` from UTC at instant `at`; positive east of UTC. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - (at.getTime() - at.getUTCMilliseconds());
}

/** Converts a wall-clock time in `timeZone` on `date` (YYYY-MM-DD) to a UTC epoch ms. */
export function zonedTimeToUtcMs(date: string, hour: number, minute: number, timeZone: string): number {
  const [y, m, d] = parseIsoDate(date);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  let guess = wall;
  for (let i = 0; i < 3; i++) guess = wall - tzOffsetMs(new Date(guess), timeZone);
  return guess;
}

/** The calendar date (YYYY-MM-DD) of instant `ms` in `timeZone`. */
export function dateInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function parseIsoDate(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Invalid date "${date}"; expected YYYY-MM-DD`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = parseIsoDate(value);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parseIsoDate(date);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parseIsoDate(from);
  const [y2, m2, d2] = parseIsoDate(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

export { MINUTE_MS, DAY_MS };
