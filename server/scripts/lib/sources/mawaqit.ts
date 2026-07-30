/**
 * Mawaqit source — mawaqit.net is the dominant mosque time-keeping platform
 * across France, Europe and North Africa, with 8000+ mosques worldwide.
 *
 * Discovery + matching use the unauthenticated nearby endpoint. The actual
 * timings are read from the matched mosque's page `confData` blob, whose
 * `times` / `iqama` arrays are consistently 5-element
 * [fajr, dhuhr, asr, maghrib, isha] — unlike the nearby endpoint's arrays,
 * which vary in length (some prepend imsak, some omit isha) and cannot be
 * positionally indexed safely.
 *
 * This fills in every namaz — not just Jummah — for matched mosques.
 * Submitted under the dedicated time keeper "MayAllahRewardMawaqit.net".
 */

import {
  ScraperSource,
  SourceMatch,
  LocalMosque,
  OtherTimings,
  MAWAQIT_SCRAPER_IDENTITY,
  USER_AGENT,
  haversineKm,
  scoreMatch,
  normalizeTime,
  normalizeJummahTimes,
  addMinutes,
} from '../jummah-import-core';

const SEARCH_URL = 'https://mawaqit.net/api/2.0/mosque/search';
const mosquePageUrl = (slug: string) => `https://mawaqit.net/en/${slug}`;

type MawaqitSearchResult = {
  uuid?: string;
  name?: string;
  slug?: string;
  latitude?: number;
  longitude?: number;
  proximity?: number; // metres from the query point
};

/** The confData blob embedded in every mawaqit.net mosque page. */
type MawaqitConfData = {
  name?: string;
  jumua?: string | null;
  jumua2?: string | null;
  jumua3?: string | null;
  jumuaAsDuhr?: boolean;
  /** [fajr, dhuhr, asr, maghrib, isha] adhan times (sunrise is a separate `shuruq` field). */
  times?: Array<string | null>;
  /** [fajr, dhuhr, asr, maghrib, isha] congregation times: "HH:MM" or "+N" offset. */
  iqama?: Array<string | null> | null;
  fixedIqama?: Array<string | null> | null;
  /** 12 months, each `{ "<dayOfMonth>": [fajr, dhuhr, asr, maghrib, isha] }`. */
  iqamaCalendar?: Array<Record<string, Array<string | null>>> | null;
};

export type MawaqitOptions = {
  maxDistanceKm: number;
  minScore: number;
  radiusKm?: number;
  timeoutMs?: number;
};

type DailyPrayer = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
// confData.times and confData.iqama are both positionally [fajr, dhuhr, asr, maghrib, isha].
const DAILY_PRAYERS: DailyPrayer[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Mawaqit occasionally prepends PHP deprecation warnings to the JSON body. */
function parseMawaqitArray(text: string): MawaqitSearchResult[] {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // fall through
  }
  const start = trimmed.search(/\[\s*[{\]]/);
  if (start >= 0) {
    try {
      const parsed = JSON.parse(trimmed.slice(start));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // fall through
    }
  }
  return [];
}

/** Extracts the `confData = { ... }` object literal via balanced-brace scan. */
function extractConfData(html: string): MawaqitConfData | null {
  const marker = html.search(/confData\s*=\s*\{/);
  if (marker < 0) return null;
  const braceStart = html.indexOf('{', marker);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(braceStart, i + 1)) as MawaqitConfData;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Resolve a Mawaqit iqama cell. Cells are either an absolute "HH:MM" or a
 * "+N" offset from that prayer's adhan. Maghrib offsets map cleanly onto the
 * app's native `maghribOffset`; other offsets are resolved against the adhan
 * time (the weekly refresh cron keeps them current).
 */
function applyIqamaCell(
  raw: string | null | undefined,
  prayer: DailyPrayer,
  adhan: string | null,
  out: OtherTimings,
): void {
  if (raw == null) return;
  const value = String(raw).trim();
  if (!value) return;

  const offsetMatch = value.match(/^\+?\s*(\d{1,3})$/);
  if (offsetMatch && !value.includes(':')) {
    const offset = Number(offsetMatch[1]);
    if (!Number.isFinite(offset)) return;
    if (prayer === 'maghrib') {
      out.maghribOffset = offset;
      return;
    }
    if (adhan) {
      const resolved = addMinutes(adhan, offset);
      if (resolved) out[prayer] = resolved;
    }
    return;
  }

  const fixed = normalizeTime(value);
  if (fixed) out[prayer] = fixed;
}

/** Picks today's iqama row: explicit `iqama`, else `fixedIqama`, else the calendar. */
function resolveIqamaArray(conf: MawaqitConfData): Array<string | null> {
  if (Array.isArray(conf.iqama) && conf.iqama.length >= 5) return conf.iqama;
  if (Array.isArray(conf.fixedIqama) && conf.fixedIqama.length >= 5) return conf.fixedIqama;
  if (Array.isArray(conf.iqamaCalendar) && conf.iqamaCalendar.length === 12) {
    const now = new Date();
    const month = conf.iqamaCalendar[now.getMonth()];
    const day = month?.[String(now.getDate())];
    if (Array.isArray(day) && day.length >= 5) return day;
  }
  return [];
}

/**
 * confData `times` / `iqama` are mostly 5-element [fajr, dhuhr, asr, maghrib,
 * isha] but some mosques splice sunrise in at index 1 (6 elements). fajr is
 * always first and the evening four are always the last four — so anchor fajr
 * to the front and the rest to the end. This makes indexing length-agnostic.
 */
function alignFive(arr: Array<string | null>): Record<DailyPrayer, string | null> {
  const n = arr.length;
  return {
    fajr: arr[0] ?? null,
    dhuhr: n >= 4 ? arr[n - 4] ?? null : null,
    asr: n >= 3 ? arr[n - 3] ?? null : null,
    maghrib: n >= 2 ? arr[n - 2] ?? null : null,
    isha: n >= 1 ? arr[n - 1] ?? null : null,
  };
}

function extractTimings(conf: MawaqitConfData): { jummah: string[]; otherTimings: OtherTimings } {
  const otherTimings: OtherTimings = {};
  const times = alignFive(Array.isArray(conf.times) ? conf.times : []);
  const iqama = alignFive(resolveIqamaArray(conf));

  for (const prayer of DAILY_PRAYERS) {
    applyIqamaCell(iqama[prayer], prayer, normalizeTime(times[prayer]), otherTimings);
  }

  const jummah = normalizeJummahTimes([conf.jumua, conf.jumua2, conf.jumua3]);
  if (jummah.length === 0 && conf.jumuaAsDuhr) {
    const dhuhr = otherTimings.dhuhr || normalizeTime(times.dhuhr);
    if (dhuhr) jummah.push(dhuhr);
  }

  return { jummah, otherTimings };
}

export function createMawaqitSource(opts: MawaqitOptions): ScraperSource {
  const radiusKm = Math.max(0.5, opts.radiusKm ?? Math.max(2, opts.maxDistanceKm * 4));
  const timeoutMs = opts.timeoutMs ?? 15_000;

  async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/html' },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function search(lat: number, lng: number): Promise<MawaqitSearchResult[]> {
    const res = await fetchWithTimeout(`${SEARCH_URL}?lat=${lat}&lon=${lng}&radius=${radiusKm}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Mawaqit search ${res.status}: ${body.slice(0, 160)}`);
    }
    return parseMawaqitArray(await res.text());
  }

  async function fetchConfData(slug: string): Promise<MawaqitConfData | null> {
    const res = await fetchWithTimeout(mosquePageUrl(slug));
    if (!res.ok) throw new Error(`Mawaqit page ${slug} ${res.status}`);
    return extractConfData(await res.text());
  }

  return {
    name: 'Mawaqit',
    scraperUser: MAWAQIT_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      const records = await search(local.latitude, local.longitude);
      if (records.length === 0) return null;

      const scored = records
        .map(record => {
          const distanceKm =
            typeof record.proximity === 'number'
              ? record.proximity / 1000
              : record.latitude != null && record.longitude != null
                ? haversineKm(local.latitude, local.longitude, record.latitude, record.longitude)
                : Number.POSITIVE_INFINITY;
          const { matchScore } = scoreMatch(
            local.name,
            record.name || '',
            distanceKm,
            opts.maxDistanceKm,
          );
          return { record, distanceKm, matchScore };
        })
        .filter(row => row.distanceKm <= opts.maxDistanceKm && row.matchScore >= opts.minScore)
        .sort((a, b) => b.matchScore - a.matchScore || a.distanceKm - b.distanceKm)
        .slice(0, 3);

      for (const row of scored) {
        const slug = row.record.slug || row.record.uuid;
        if (!slug) continue;

        const conf = await fetchConfData(slug);
        if (!conf) continue;

        const { jummah, otherTimings } = extractTimings(conf);
        const hasOther = Object.keys(otherTimings).length > 0;
        if (jummah.length === 0 && !hasOther) continue;

        return {
          sourceName: 'Mawaqit',
          sourceUrl: mosquePageUrl(slug),
          sourceMosqueName: conf.name || row.record.name,
          sourceMosqueId: row.record.uuid,
          matchScore: row.matchScore,
          distanceKm: row.distanceKm,
          jummah,
          otherTimings: hasOther ? otherTimings : undefined,
          extraNotes: [
            "Friday + full daily iqamah schedule read from the mosque's own Mawaqit confData.",
          ],
        };
      }
      return null;
    },
  };
}
