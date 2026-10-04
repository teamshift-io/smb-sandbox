/** Timezone-aware date helpers (Intl only, no dependencies). */

export const DAY_MS = 86_400_000;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localParts(ms: number, tz: string): LocalParts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { year: out.year!, month: out.month!, day: out.day!, hour: out.hour! % 24, minute: out.minute! };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** YYYY-MM-DD of an instant in a timezone. */
export function dateInZone(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** UTC epoch ms of a local wall-clock time in a timezone. */
export function zonedTimeToUtcMs(date: string, hour: number, minute: number, tz: string): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const target = Date.UTC(y, mo - 1, d, hour, minute);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    guess += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return guess;
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** "Wed, Oct 7 at 8:00 AM" in the given timezone. */
export function formatLocal(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  const wd = WEEKDAYS[weekdayOf(`${p.year}-${pad(p.month)}-${pad(p.day)}`)];
  const h12 = p.hour % 12 || 12;
  return `${wd}, ${MONTHS_SHORT[p.month - 1]} ${p.day} at ${h12}:${pad(p.minute)} ${p.hour < 12 ? "AM" : "PM"}`;
}

/**
 * True when `text` names both the local date (e.g. "Oct 7", "October 7th",
 * "10/7", "2026-10-07") and the local time (e.g. "8:00 AM", "8am", "08:00") of `ms`.
 */
export function mentionsLocalTime(text: string, ms: number, tz: string): boolean {
  const p = localParts(ms, tz);
  const d = p.day;
  const datePatterns = [
    new RegExp(`\\b(${MONTHS_SHORT[p.month - 1]}|${MONTHS_LONG[p.month - 1]})\\.?\\s+0?${d}(st|nd|rd|th)?\\b`, "i"),
    new RegExp(`(^|[^\\d/])0?${p.month}/0?${d}(\\b|/)`),
    new RegExp(`\\b${p.year}-${pad(p.month)}-${pad(d)}\\b`),
  ];
  const h12 = p.hour % 12 || 12;
  const ampm = p.hour < 12 ? "a\\.?\\s?m\\.?" : "p\\.?\\s?m\\.?";
  const timePatterns = [
    new RegExp(`(^|[^\\d:])${h12}:${pad(p.minute)}(?!\\d)`, "i"),
    new RegExp(`(^|[^\\d:])${pad(p.hour)}:${pad(p.minute)}(?!\\d)`),
  ];
  if (p.minute === 0) timePatterns.push(new RegExp(`(^|[^\\d:])${h12}\\s?${ampm}`, "i"));
  return datePatterns.some((r) => r.test(text)) && timePatterns.some((r) => r.test(text));
}
