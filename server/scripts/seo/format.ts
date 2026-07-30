// Shared helpers for the SEO static-page generator.
//
// Kept dependency-free (no Prisma, no fs) so it can be unit-tested in
// isolation and reused by both the page templates and the generator.

/**
 * Turn an arbitrary mosque/city name into a URL-safe slug.
 * Strips diacritics, drops apostrophes, collapses everything else to
 * single hyphens. Non-latin scripts (e.g. Arabic-only names) collapse to
 * empty — callers must append a stable unique suffix (the mosque id) so
 * URLs never collide or become blank.
 */
export function slugify(input: string): string {
  return (input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/['’`]/g, '') // drop apostrophes so "masjid-e-noor" not "masjid-e--noor"
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alnum → single hyphen
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Escape a string for safe interpolation into HTML text/attributes. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialize an object for a <script type="application/ld+json"> block.
 * The `</` and `<` escaping prevents a malicious/edge mosque name from
 * breaking out of the script element.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}

// ── Prayer-time normalization ───────────────────────────────────────────
// Production stores flat times: { fajr: '05:00', dhuhr: '13:30', ... } with
// jummah as a string[]. Older/imported rows may use nested
// { adhan, iqamah } objects and the label "zuhr". We render both.

const PRAYER_LABELS: Record<string, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise',
  dhuhr: 'Dhuhr',
  zuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

// Order prayers appear in a day. zuhr is an alias handled at read time.
const PRAYER_ORDER = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Pull a displayable "HH:MM" out of a value that may be a string or object. */
export function timeOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const t = v.iqamah ?? v.time ?? v.adhan;
    return typeof t === 'string' && t.trim() ? t.trim() : null;
  }
  return null;
}

export interface PrayerRow {
  key: string;
  label: string;
  time: string;
}

/**
 * Flatten a timings JSON blob into ordered {label, time} rows for the five
 * daily prayers. Returns [] when nothing renderable is present — the caller
 * uses that to mark a page noindex (avoids thin-content pages).
 */
export function prayerRows(timings: unknown): PrayerRow[] {
  if (!timings || typeof timings !== 'object') return [];
  const t = timings as Record<string, unknown>;
  const rows: PrayerRow[] = [];
  for (const key of PRAYER_ORDER) {
    // dhuhr may be stored under the "zuhr" alias.
    const raw = key === 'dhuhr' ? (t.dhuhr ?? t.zuhr) : t[key];
    const time = timeOf(raw);
    if (time) rows.push({ key, label: PRAYER_LABELS[key], time });
  }
  return rows;
}

/** Extract Jummah (Friday) times, which are stored as an array. */
export function jummahTimes(timings: unknown): string[] {
  if (!timings || typeof timings !== 'object') return [];
  const j = (timings as Record<string, unknown>).jummah;
  if (!Array.isArray(j)) {
    const single = timeOf(j);
    return single ? [single] : [];
  }
  return j.map(timeOf).filter((x): x is string => Boolean(x));
}
