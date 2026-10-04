/**
 * Wall-clock helpers. Chains work in "local ms": a UTC epoch value whose
 * calendar fields equal the company's local wall clock. US DST rules are
 * implemented here (not via Intl) so output never drifts with ICU updates.
 */
import type { Rng } from "./rng.js";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const TIMEZONES = {
  "America/New_York": -5,
  "America/Chicago": -6,
} as const;
export type Timezone = keyof typeof TIMEZONES;

/** Latest local minute any activity may happen (keeps UTC date == local date). */
export const LAST_MINUTE = 17 * 60 + 45;
const STAFF_OPEN = 8 * 60;
const STAFF_CLOSE = 17 * 60 + 15;
const CUSTOMER_OPEN = 7 * 60;
const CUSTOMER_CLOSE = 17 * 60 + 30;

export function parseDate(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (toDate(ms) !== date) throw new Error(`Invalid date "${date}"`);
  return ms;
}

export function toDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function dayStart(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}

export function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(day, lastDay)) + (ms - dayStart(ms));
}

function nthSunday(year: number, month: number, n: number): number {
  const first = Date.UTC(year, month, 1);
  const dow = new Date(first).getUTCDay();
  return first + (((7 - dow) % 7) + 7 * (n - 1)) * DAY;
}

function isDst(localMs: number): boolean {
  const y = new Date(localMs).getUTCFullYear();
  const start = nthSunday(y, 2, 2) + 2 * HOUR;
  const end = nthSunday(y, 10, 1) + 2 * HOUR;
  return localMs >= start && localMs < end;
}

export function toIso(localMs: number, tz: Timezone): string {
  const offset = TIMEZONES[tz] + (isDst(localMs) ? 1 : 0);
  return new Date(localMs - offset * HOUR).toISOString().replace(".000Z", "Z");
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue, Oct 6 at 9:30 AM" */
export function fmtWhen(localMs: number): string {
  const d = new Date(localMs);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()} at ${hh}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Oct 6, 2026" */
export function fmtDate(localMs: number): string {
  const d = new Date(localMs);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function monthName(localMs: number): string {
  const d = new Date(localMs);
  return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Business-hours arithmetic for one company. */
export class Clock {
  constructor(
    readonly tz: Timezone,
    readonly openDays: readonly number[],
  ) {}

  iso(localMs: number): string {
    return toIso(localMs, this.tz);
  }

  isOpen(day: number): boolean {
    return this.openDays.includes(new Date(day).getUTCDay());
  }

  nextOpenDay(day: number): number {
    let d = dayStart(day);
    while (!this.isOpen(d)) d += DAY;
    return d;
  }

  /** A staff action `min..max` minutes after t, pushed into business hours. */
  staffAfter(t: number, minMin: number, maxMin: number, rng: Rng): number {
    return this.staffNormalize(t + rng.int(minMin, maxMin) * MIN, rng);
  }

  staffNormalize(x: number, rng: Rng): number {
    const d = dayStart(x);
    const m = Math.floor((x - d) / MIN);
    if (!this.isOpen(d) || m >= STAFF_CLOSE) {
      return this.nextOpenDay(d + DAY) + (STAFF_OPEN + rng.int(0, 90)) * MIN;
    }
    if (m < STAFF_OPEN) return d + (STAFF_OPEN + rng.int(0, 60)) * MIN;
    return x;
  }

  /** A customer action (any day of the week, daytime hours). */
  customerAfter(t: number, minMin: number, maxMin: number, rng: Rng): number {
    const x = t + rng.int(minMin, maxMin) * MIN;
    const d = dayStart(x);
    const m = Math.floor((x - d) / MIN);
    if (m >= CUSTOMER_CLOSE) return d + DAY + (CUSTOMER_OPEN + 60 + rng.int(0, 240)) * MIN;
    if (m < CUSTOMER_OPEN) return d + (CUSTOMER_OPEN + 30 + rng.int(0, 180)) * MIN;
    return x;
  }

  /** Random time on the n-th open day after t (n >= 1), within staff hours. */
  addBusinessDays(t: number, n: number, rng: Rng): number {
    let d = dayStart(t);
    let left = Math.max(1, n);
    while (left > 0) {
      d += DAY;
      if (this.isOpen(d)) left--;
    }
    return d + rng.int(STAFF_OPEN, 16 * 60) * MIN;
  }

  /** Customer-side moment inside a given day. */
  customerMoment(day: number, rng: Rng): number {
    return dayStart(day) + rng.int(CUSTOMER_OPEN, CUSTOMER_CLOSE - 15) * MIN;
  }

  staffMoment(day: number, rng: Rng): number {
    return dayStart(day) + rng.int(STAFF_OPEN, 16 * 60 + 30) * MIN;
  }

  /** Job start slot on an open day such that the job ends by 17:00. */
  jobSlot(day: number, durationMin: number, rng: Rng): number {
    const d = this.nextOpenDay(day);
    const latest = Math.max(STAFF_OPEN, 17 * 60 - durationMin);
    const slots = Math.floor((latest - STAFF_OPEN) / 30);
    return d + (STAFF_OPEN + 30 * rng.int(0, slots)) * MIN;
  }
}
