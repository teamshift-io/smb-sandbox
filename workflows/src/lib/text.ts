/** Text helpers used by verifiers to read what an agent actually wrote. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function digits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function isValidEmail(value: string | null | undefined): value is string {
  return typeof value === "string" && EMAIL_RE.test(value);
}

export function isValidPhone(value: string | null | undefined): value is string {
  const d = digits(value);
  return d.length >= 10 && d.length <= 15;
}

/** "$1,234.56" */
export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Every dollar amount written in the text ("$1,234.56", "$1234", "$ 99.5"), in cents. */
export function moneyAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
  for (const m of text.matchAll(re)) {
    const whole = Number(m[1]!.replace(/,/g, ""));
    const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
    out.push(whole * 100 + frac);
  }
  return out;
}

/** True when the text contains the amount, within `toleranceCents` (default: exact to the cent). */
export function mentionsMoney(text: string, cents: number, toleranceCents = 0): boolean {
  return moneyAmounts(text).some((a) => Math.abs(a - cents) <= toleranceCents);
}

export function includesCI(text: string | null | undefined, needle: string): boolean {
  return (text ?? "").toLowerCase().includes(needle.toLowerCase());
}

/** True when `text` contains `needle` as a whole token (so "Q-12" does not match "Q-128"). */
export function includesToken(text: string | null | undefined, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${esc}(?![A-Za-z0-9])`, "i").test(text ?? "");
}

const STOPWORDS = new Set(
  (
    "about above after again also another any are around back been before being both but can cannot could did does doing done down each even every " +
    "from further get gets getting going good great had has have having hello help here hers how into its just know last like looking love make many " +
    "more most much need needs next not now off once only other our ours out over own please quick really reach reaching same should since some soon " +
    "still such sure talk tell than thank thanks that the their them then there these they thing think this those through time today touch very want " +
    "wanted was way well were what when where which while who why will with would year years yes you your yours we'd i'd it's i'm we're you're can't " +
    "don't isn't let's someone something anything team happy glad"
  ).split(/\s+/),
);

/** Significant lowercase words (4+ letters, not stopwords). */
export function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) {
    const w = raw.replace(/^'+|'+$/g, "");
    if (w.length >= 4 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** How many significant words of `reference` appear in `text`. */
export function keywordOverlap(text: string, reference: string): number {
  const have = keywords(text);
  let n = 0;
  for (const w of keywords(reference)) if (have.has(w)) n++;
  return n;
}
