/**
 * Planning: decides who exists and what happens when, before any record is
 * written. Everything here is drawn from one planning stream so the plan is a
 * pure function of (industry, seed, size, asOf, months).
 */
import type { Offering, IndustryProfile } from "./industries/types.js";
import { Rng } from "./rng.js";
import type { Address, EmployeeRole, LeadSource } from "./schema.js";
import { DAY, addMonths, dayStart, Clock, toDate } from "./time.js";
import {
  BUSINESS_ADJECTIVES,
  BUSINESS_NOUNS,
  BUSINESS_PATTERNS,
  CITY_NAMES,
  FIRST_NAMES,
  LAST_NAMES,
  MAIL_DOMAINS,
  REGIONS,
  STREET_NAMES,
  STREET_SUFFIXES,
  type Region,
} from "./words.js";

export const SIZES = { small: 15, medium: 40, large: 150 } as const;

/** Quoted leads (sent at least a month before asOf) every plan should contain. */
const MIN_QUOTED_LEADS = 3;
export type Size = keyof typeof SIZES;

export interface Person {
  first: string;
  last: string;
  email: string;
  phone: string;
  address: Address;
  title: string | null;
}

export interface EmployeeSeed {
  first: string;
  last: string;
  email: string;
  phone: string;
  role: EmployeeRole;
  hiredOn: string;
  active: boolean;
}

export interface ExistingPlan {
  person: Person;
  second: Person | null;
  businessName: string | null;
  createdAt: number;
  source: LeadSource;
  recurringDue: number | null;
  churnIfIdle: boolean;
  tags: string[];
}

export type Fate = "won" | "decline" | "expire" | "lost-early" | "disqualified";

export interface LeadPlan {
  arrival: number;
  offering: Offering;
  source: LeadSource;
  fate: Fate;
  person: Person | null;
  businessName: string | null;
  existing: number | null;
  request: string;
  tags: string[];
}

export type ChainSpec =
  | { kind: "lead"; start: number; lead: LeadPlan }
  | { kind: "recurring"; start: number; existing: number; firstDue: number }
  | { kind: "noise"; start: number; existing: number; type: "missed-call" | "question" }
  /** A job already booked for the next two weeks; `dayOffset` is days after asOf. */
  | { kind: "ahead"; start: number; dayOffset: number };

export interface Plan {
  enforceStaffAvailability: boolean;
  P: IndustryProfile;
  seed: number;
  size: Size;
  region: Region;
  clock: Clock;
  startMs: number;
  /** Last local moment anything may happen. */
  endMs: number;
  asOf: string;
  startDate: string;
  companyName: string;
  slug: string;
  companyPhone: string;
  companyAddress: Address;
  employees: EmployeeSeed[];
  existing: ExistingPlan[];
  chains: ChainSpec[];
  spares: Person[];
  quoteBase: number;
  invoiceBase: number;
}

function slugify(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/&/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && w !== "co" && w !== "the");
  let slug = "";
  for (const w of words) {
    if (slug && slug.length + w.length > 24) break;
    slug += w;
  }
  return slug;
}

function emailLocal(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

class People {
  private phones: string[];
  private phoneIdx = 0;
  private emails = new Set<string>();
  private names = new Set<string>();
  private businesses = new Set<string>();
  readonly zips: Map<string, string>;

  constructor(
    private rng: Rng,
    readonly region: Region,
    readonly cities: readonly string[],
  ) {
    const pool: string[] = [];
    for (const ac of region.areaCodes) {
      for (let n = 100; n <= 199; n++) pool.push(`(${ac}) 555-01${String(n - 100).padStart(2, "0")}`);
    }
    this.phones = rng.shuffle(pool);
    this.zips = new Map(cities.map((c, i) => [c, `${region.zipPrefix}${String(110 + ((i * 137 + rng.int(0, 60)) % 880)).padStart(3, "0")}`]));
  }

  phone(): string {
    const p = this.phones[this.phoneIdx % this.phones.length] as string;
    this.phoneIdx++;
    return p;
  }

  uniqueEmail(local: string, domain: string): string {
    let email = `${local}@${domain}`;
    let n = 2;
    while (this.emails.has(email)) email = `${local}${n++}@${domain}`;
    this.emails.add(email);
    return email;
  }

  address(business: boolean): Address {
    const city = this.rng.pick(this.cities);
    const street = `${this.rng.int(100, 9899)} ${this.rng.pick(STREET_NAMES)} ${this.rng.pick(STREET_SUFFIXES)}`;
    const line1 = business && this.rng.chance(0.5) ? `${street}, Suite ${this.rng.int(1, 4)}${String(this.rng.int(0, 20)).padStart(2, "0")}` : street;
    return { line1, city, region: this.region.state, postalCode: this.zips.get(city) as string, country: "US" };
  }

  name(): { first: string; last: string } {
    for (let i = 0; i < 50; i++) {
      const first = this.rng.pick(FIRST_NAMES);
      const last = this.rng.pick(LAST_NAMES);
      const key = `${first} ${last}`;
      if (!this.names.has(key)) {
        this.names.add(key);
        return { first, last };
      }
    }
    return { first: this.rng.pick(FIRST_NAMES), last: this.rng.pick(LAST_NAMES) };
  }

  household(lastOverride?: string): Person {
    const n = this.name();
    const last = lastOverride ?? n.last;
    const f = emailLocal(n.first);
    const l = emailLocal(last);
    const local = this.rng.pick([`${f}.${l}`, `${f}${l}`, `${f[0]}${l}`, `${f}_${l}`, `${f}.${l}${this.rng.int(10, 99)}`]);
    return {
      first: n.first,
      last,
      email: this.uniqueEmail(local, this.rng.pick(MAIL_DOMAINS)),
      phone: this.phone(),
      address: this.address(false),
      title: null,
    };
  }

  businessContact(domain: string, address: Address, title: string): Person {
    const n = this.name();
    return {
      first: n.first,
      last: n.last,
      email: this.uniqueEmail(emailLocal(n.first), domain),
      phone: this.phone(),
      address,
      title,
    };
  }

  businessName(): string {
    for (let i = 0; i < 100; i++) {
      const name = this.rng
        .pick(BUSINESS_PATTERNS)
        .replace("{Last2}", this.rng.pick(LAST_NAMES))
        .replace("{Last}", this.rng.pick(LAST_NAMES))
        .replace("{City}", this.rng.pick(CITY_NAMES))
        .replace("{Adj}", this.rng.pick(BUSINESS_ADJECTIVES))
        .replace("{Noun}", this.rng.pick(BUSINESS_NOUNS));
      if (!this.businesses.has(name)) {
        this.businesses.add(name);
        return name;
      }
    }
    return `${this.rng.pick(LAST_NAMES)} Group ${this.businesses.size}`;
  }
}

function pickTags(rng: Rng, tags: readonly string[]): string[] {
  const n = rng.int(0, 2);
  return rng.shuffle(tags).slice(0, n).sort();
}

export interface PlanInput {
  enforceStaffAvailability?: boolean;
  P: IndustryProfile;
  seed: number;
  size: Size;
  asOf: string;
  months: number;
  spareCount: number;
}

export function makePlan(input: PlanInput): Plan {
  const { P, seed, size, months } = input;
  const rng = new Rng(seed).fork("plan", P.id);
  const region = rng.pick(REGIONS);
  const clock = new Clock(region.timezone, P.openDays);
  const asOfDay = dayStart(Date.parse(`${input.asOf}T00:00:00Z`));
  const startMs = addMonths(asOfDay, -months) + DAY;
  const endMs = asOfDay + (17 * 60 + 59) * 60_000;
  const totalDays = Math.round((asOfDay - startMs) / DAY) + 1;

  const cities = rng.shuffle(CITY_NAMES).slice(0, 6);
  const people = new People(rng, region, cities);
  const companyName = rng.pick(P.companyNames);
  const slug = slugify(companyName);
  const companyDomain = `${slug}.example`;
  const companyPhone = people.phone();
  const companyAddress = people.address(true);

  // Employees
  const employees: EmployeeSeed[] = [];
  const usedFirst = new Set<string>();
  const addEmployee = (role: EmployeeRole, active: boolean): void => {
    const n = people.name();
    let local = emailLocal(n.first);
    if (usedFirst.has(local)) local = `${local}.${emailLocal(n.last)[0]}`;
    usedFirst.add(local);
    const yearsBack = role === "owner" ? rng.int(8, 20) : rng.int(1, 9);
    employees.push({
      first: n.first,
      last: n.last,
      email: people.uniqueEmail(local, companyDomain),
      phone: people.phone(),
      role,
      hiredOn: toDate(startMs - yearsBack * 365 * DAY - rng.int(0, 300) * DAY),
      active,
    });
  };
  for (const r of P.roster) for (let i = 0; i < r[size]; i++) addEmployee(r.role, true);
  if (size !== "small") {
    const crewRole = P.offerings[0]?.crew[0] ?? "technician";
    addEmployee(crewRole, false);
  }

  // Existing customers (relationships that predate the simulated window)
  const N = SIZES[size];
  const E = Math.round(N * P.existingShare);
  const recurring = P.recurringOffering ? P.offerings.find((o) => o.key === P.recurringOffering) : undefined;
  const everyMonths = P.offerings.find((o) => o.recurring?.offering === P.recurringOffering)?.recurring?.everyMonths ?? 6;
  const existing: ExistingPlan[] = [];
  const makeCustomerPeople = (): { person: Person; second: Person | null; businessName: string | null } => {
    if (P.customerKind === "business") {
      const businessName = people.businessName();
      const domain = `${slugify(businessName)}.example`;
      const address = people.address(true);
      const person = people.businessContact(domain, address, rng.pick(P.contactTitles));
      const second = rng.chance(0.4) ? people.businessContact(domain, address, rng.pick(P.contactTitles)) : null;
      return { person, second, businessName };
    }
    const person = people.household();
    let second: Person | null = null;
    if (rng.chance(0.25)) {
      second = people.household(person.last);
      second = { ...second, address: person.address };
    }
    return { person, second, businessName: null };
  };
  const sourceList = Object.keys(P.sourceWeights) as LeadSource[];
  const pickSource = (): LeadSource => rng.weighted(sourceList, (s) => P.sourceWeights[s] ?? 0);

  for (let i = 0; i < E; i++) {
    const who = makeCustomerPeople();
    const created = clock.staffMoment(startMs - rng.int(20, 1400) * DAY, rng);
    const onPlan = recurring !== undefined && rng.chance(P.recurringShare);
    existing.push({
      ...who,
      createdAt: created,
      source: pickSource(),
      recurringDue: onPlan ? startMs + rng.int(25, 25 + everyMonths * 30) * DAY : null,
      churnIfIdle: rng.chance(0.4),
      tags: pickTags(rng, P.tags),
    });
  }

  // Leads
  const chains: ChainSpec[] = [];
  const newOfferings = P.offerings.filter((o) => o.weight > 0);
  const repeatOfferings = newOfferings.filter((o) => !o.newOnly);
  const arrivalFor = (source: LeadSource): number => {
    let day = startMs + rng.int(0, totalDays - 1) * DAY;
    if (source === "phone" || source === "walk-in" || source === "repeat") {
      day = clock.nextOpenDay(day);
      if (day > asOfDay) day = clock.nextOpenDay(asOfDay - 7 * DAY);
      return clock.staffMoment(day, rng);
    }
    return clock.customerMoment(day, rng);
  };
  const fateFor = (o: Offering, repeat: boolean): Fate => {
    const won = repeat ? 0.78 : 0.62;
    if (!o.quote) return rng.chance(repeat ? 0.92 : 0.85) ? "won" : "lost-early";
    const r = rng.next();
    if (r < won) return "won";
    if (r < won + 0.15) return "decline";
    if (r < won + 0.25) return "expire";
    return "lost-early";
  };

  const newCount = N - E;
  const disqualified = Math.max(1, Math.round(newCount * 0.15));
  for (let i = 0; i < newCount + disqualified; i++) {
    const offering = rng.weighted(newOfferings, (o) => o.weight);
    const source = pickSource();
    const who = makeCustomerPeople();
    const lead: LeadPlan = {
      arrival: arrivalFor(source),
      offering,
      source,
      fate: i < disqualified ? "disqualified" : fateFor(offering, false),
      person: who.person,
      businessName: who.businessName,
      existing: null,
      request: rng.pick(offering.requests),
      tags: pickTags(rng, P.tags),
    };
    chains.push({ kind: "lead", start: lead.arrival, lead });
  }

  // Small runs can draw almost no quoted work, which leaves quote-related anomalies
  // nothing to land on. Promote the earliest plain leads to quoted ones (no extra
  // random draws, so the rest of the plan is unchanged).
  const quoted = newOfferings.filter((o) => o.quote);
  const leadPlans = chains.flatMap((c) => (c.kind === "lead" ? [c.lead] : []));
  const isQuoted = (l: LeadPlan) => l.offering.quote && l.fate !== "disqualified" && l.fate !== "lost-early";
  const early = (l: LeadPlan) => l.arrival <= asOfDay - 30 * DAY;
  let missing = MIN_QUOTED_LEADS - leadPlans.filter((l) => isQuoted(l) && early(l)).length;
  for (const l of [...leadPlans].sort((a, b) => a.arrival - b.arrival)) {
    if (missing <= 0 || quoted.length === 0) break;
    if (!early(l) || l.fate === "disqualified" || isQuoted(l)) continue;
    const o = quoted[missing % quoted.length] as Offering;
    l.offering = o;
    l.request = o.requests[0] as string;
    l.fate = "won";
    missing--;
  }

  const repeats = E === 0 ? 0 : Math.round(E * P.repeatRate * (months / 12));
  for (let i = 0; i < repeats; i++) {
    const offering = rng.weighted(repeatOfferings, (o) => o.weight);
    const lead: LeadPlan = {
      arrival: arrivalFor("repeat"),
      offering,
      source: "repeat",
      fate: fateFor(offering, true),
      person: null,
      businessName: null,
      existing: rng.int(0, E - 1),
      request: rng.pick(offering.repeatRequests ?? offering.requests),
      tags: [],
    };
    chains.push({ kind: "lead", start: lead.arrival, lead });
  }

  existing.forEach((e, i) => {
    if (e.recurringDue !== null) chains.push({ kind: "recurring", start: e.recurringDue, existing: i, firstDue: e.recurringDue });
  });

  const noise = E === 0 ? 0 : Math.round(N * 0.35 * (months / 12));
  for (let i = 0; i < noise; i++) {
    const day = clock.nextOpenDay(startMs + rng.int(0, totalDays - 10) * DAY);
    const start = clock.staffMoment(day, rng);
    chains.push({ kind: "noise", start, existing: rng.int(0, E - 1), type: i % 2 === 0 ? "missed-call" : "question" });
  }

  chains.sort((a, b) => a.start - b.start);

  // The forward schedule, spread across the next 14 days. Its own stream, and run
  // after every other storyline, so it never shifts the history above.
  const aheadRng = new Rng(seed).fork("ahead", P.id);
  const ahead = Math.max(3, Math.round(N * P.bookedAhead.rate));
  for (let k = 0; k < ahead; k++) {
    chains.push({ kind: "ahead", start: endMs, dayOffset: 1 + Math.floor(((k + aheadRng.next()) * 14) / ahead) });
  }

  const quoteBase = 1000 + rng.int(20, 400);
  const invoiceBase = 2000 + rng.int(50, 800);

  // Spare people for injected anomalies (drawn last so they never shift the rest).
  const spares: Person[] = [];
  for (let i = 0; i < input.spareCount; i++) spares.push(makeCustomerPeople().person);

  return {
    enforceStaffAvailability: input.enforceStaffAvailability ?? false,
    P,
    seed,
    size,
    region,
    clock,
    startMs,
    endMs,
    asOf: input.asOf,
    startDate: toDate(startMs),
    companyName,
    slug,
    companyPhone,
    companyAddress,
    employees,
    existing,
    chains,
    spares,
    quoteBase,
    invoiceBase,
  };
}
