/**
 * FivePrayers source - public member list + visible display pages.
 *
 * FivePrayers pages expose daily iqamah cells with stable ids (`fajIq`,
 * `dhuIq`, etc.) and a Jumu'ah cell (`fdp`). Submitted under the dedicated
 * time keeper "MayAllahRewardFivePrayers.org".
 */

import {
  ScraperSource,
  SourceMatch,
  LocalMosque,
  OtherTimings,
  FIVEPRAYERS_SCRAPER_IDENTITY,
  fetchText,
  haversineKm,
  nameSimilarity,
  normalizeName,
  normalizeTime,
  normalizeJummahTimes,
  scoreMatch,
} from '../jummah-import-core';

const SEARCH_URL = 'https://www.fiveprayers.org/display/search.php';
const DISPLAY_URL = 'https://www.fiveprayers.org/display/index.php';
const SOURCE_NAME = 'FivePrayers';

type FivePrayersDirectoryEntry = {
  id: string;
  label: string;
  name: string;
  location: string;
};

type DailyPrayer = Exclude<keyof OtherTimings, 'maghribOffset'>;

export type FivePrayersPageTimings = {
  mosqueName?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  jummah: string[];
  otherTimings: OtherTimings;
};

export type FivePrayersOptions = {
  maxDistanceKm: number;
  minScore: number;
  timeoutMs?: number;
  candidateLimit?: number;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function cleanText(value: string): string {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLabel(label: string): { name: string; location: string } {
  const parts = label.split(/\.\s+/).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { name: label.trim(), location: '' };
  return {
    name: parts.slice(0, -1).join('. ').trim(),
    location: parts[parts.length - 1].trim(),
  };
}

function isLowValueEntry(entry: FivePrayersDirectoryEntry): boolean {
  const name = normalizeName(entry.name);
  const label = normalizeName(entry.label);
  if (!name || name.length < 3) return true;
  if (['home', 'test', 'personal', 'no', 'none'].includes(name)) return true;
  return /\b(test system|testmasjid|masjid test|home setup|personal|family room|no masjid|mosque example)\b/i.test(label);
}

export function parseFivePrayersDirectory(html: string): FivePrayersDirectoryEntry[] {
  const entries: FivePrayersDirectoryEntry[] = [];
  const seen = new Set<string>();
  const optionRe = /<option\b[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
  let match: RegExpExecArray | null;
  while ((match = optionRe.exec(html))) {
    const id = decodeHtml(match[1]).trim();
    if (!id || id.toLowerCase() === 'none' || seen.has(id)) continue;
    const label = cleanText(match[2]);
    if (!label) continue;
    const { name, location } = splitLabel(label);
    const entry = { id, label, name, location };
    if (isLowValueEntry(entry)) continue;
    seen.add(id);
    entries.push(entry);
  }
  return entries;
}

function tagTextById(html: string, id: string): string | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<[^>]+id\\s*=\\s*['"]${escaped}['"][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'));
  return match ? cleanText(match[1]) : null;
}

function parseCoord(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function extractCoordinates(html: string): { latitude?: number; longitude?: number } {
  const parms = tagTextById(html, 'parms');
  const fromParms = parms?.match(/\b(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (fromParms) {
    return { latitude: parseCoord(fromParms[1]), longitude: parseCoord(fromParms[2]) };
  }
  const text = cleanText(html);
  const pair = text.match(/\b(-?\d{1,3}\.\d{3,})\s+(-?\d{1,3}\.\d{3,})\b/);
  return { latitude: parseCoord(pair?.[1] || null), longitude: parseCoord(pair?.[2] || null) };
}

export function extractFivePrayersTimings(html: string): FivePrayersPageTimings {
  const otherTimings: OtherTimings = {};
  const mapping: Array<[DailyPrayer, string]> = [
    ['fajr', 'fajIq'],
    ['dhuhr', 'dhuIq'],
    ['asr', 'asrIq'],
    ['maghrib', 'magIq'],
    ['isha', 'ishIq'],
  ];
  for (const [prayer, id] of mapping) {
    const time = normalizeTime(tagTextById(html, id));
    if (time) otherTimings[prayer] = time;
  }

  const jummah = normalizeJummahTimes([tagTextById(html, 'fdp')]);
  const { latitude, longitude } = extractCoordinates(html);
  return {
    mosqueName: tagTextById(html, 'logoBox') || undefined,
    location: tagTextById(html, 'dateBox') || undefined,
    latitude,
    longitude,
    jummah,
    otherTimings,
  };
}

function displayUrl(id: string): string {
  const params = new URLSearchParams({ id });
  return `${DISPLAY_URL}?${params.toString()}`;
}

function candidateScore(local: LocalMosque, entry: FivePrayersDirectoryEntry): number {
  const nameScore = Math.max(nameSimilarity(local.name, entry.name), nameSimilarity(local.name, entry.label));
  const localCity = normalizeName(local.city);
  const entryLocation = normalizeName(entry.location);
  const cityBonus = localCity && entryLocation.includes(localCity) ? 0.2 : 0;
  return Math.min(1, nameScore + cityBonus);
}

export function createFivePrayersSource(opts: FivePrayersOptions): ScraperSource {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const candidateLimit = opts.candidateLimit ?? 6;
  let directoryPromise: Promise<FivePrayersDirectoryEntry[]> | null = null;

  async function directory(): Promise<FivePrayersDirectoryEntry[]> {
    directoryPromise ||= fetchText(SEARCH_URL, timeoutMs).then(parseFivePrayersDirectory);
    return directoryPromise;
  }

  return {
    name: SOURCE_NAME,
    scraperUser: FIVEPRAYERS_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      const candidates = (await directory())
        .map(entry => ({ entry, preScore: candidateScore(local, entry) }))
        .filter(row => row.preScore >= Math.max(0.55, opts.minScore - 0.15))
        .sort((a, b) => b.preScore - a.preScore)
        .slice(0, candidateLimit);

      for (const row of candidates) {
        const url = displayUrl(row.entry.id);
        let html: string;
        try {
          html = await fetchText(url, timeoutMs);
        } catch {
          continue;
        }
        const timings = extractFivePrayersTimings(html);
        if (timings.latitude == null || timings.longitude == null) continue;
        const distanceKm = haversineKm(local.latitude, local.longitude, timings.latitude, timings.longitude);
        const sourceName = timings.mosqueName || row.entry.name;
        const { matchScore } = scoreMatch(local.name, sourceName, distanceKm, opts.maxDistanceKm);
        if (distanceKm > opts.maxDistanceKm || matchScore < opts.minScore) continue;

        const hasOther = Object.keys(timings.otherTimings).length > 0;
        if (timings.jummah.length === 0 && !hasOther) continue;
        return {
          sourceName: SOURCE_NAME,
          sourceUrl: url,
          websiteUrl: null,
          sourceMosqueName: sourceName,
          sourceMosqueId: row.entry.id,
          matchScore,
          distanceKm,
          jummah: timings.jummah,
          otherTimings: hasOther ? timings.otherTimings : undefined,
          extraNotes: [
            'Friday + daily iqamah schedule read from the public FivePrayers display page.',
          ],
        };
      }
      return null;
    },
  };
}
