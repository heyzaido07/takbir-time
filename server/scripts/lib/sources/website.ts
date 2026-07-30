/**
 * Direct masjid website source — for mosques that have their own website saved
 * on the record, probe common prayer-time paths and extract visible Jummah and
 * daily iqamah/jamaat times from the surrounding text. Submitted under a
 * dedicated time keeper that credits masjid website administrators.
 */

import {
  ScraperSource,
  SourceMatch,
  LocalMosque,
  OtherTimings,
  MASJID_WEBSITE_SCRAPER_IDENTITY,
  USER_AGENT,
  normalizeTime,
  normalizeJummahTimes,
} from '../jummah-import-core';

const DEFAULT_MAX_FETCHES_PER_SITE = 4;

const COMMON_PATHS = [
  '/',
  '/prayer-times',
  '/prayer-time',
  '/prayer-timetable',
  '/salah-times',
  '/salah',
  '/salat',
  '/iqamah',
  '/iqama',
  '/jummah',
  '/jumma',
  '/jumuah',
  '/friday-prayer',
];

// Directory aggregators are covered by their own dedicated sources.
const DIRECTORY_DOMAINS = new Set([
  'jamaat360.com',
  'www.jamaat360.com',
  'mawaqit.net',
  'www.mawaqit.net',
]);

const LOW_VALUE_DOMAINS = new Set([
  'facebook.com',
  'www.facebook.com',
  'instagram.com',
  'www.instagram.com',
  'x.com',
  'twitter.com',
  'www.twitter.com',
  'youtube.com',
  'www.youtube.com',
]);

export type WebsiteOptions = {
  timeoutMs?: number;
};

type TimeHit = { raw: string; time: string; index: number };
type DailyPrayer = Exclude<keyof OtherTimings, 'maghribOffset'>;

const PRAYER_MARKERS: Record<DailyPrayer, RegExp> = {
  fajr: /\b(fajr|fajar|subh)\b/i,
  dhuhr: /\b(dhuhr|zuhr|zuhur|zoh?r)\b/i,
  asr: /\b(asr)\b/i,
  maghrib: /\b(maghrib|magrib)\b/i,
  isha: /\b(isha|isha'a|esha|eisha)\b/i,
};

const PRAYER_RANGES: Record<DailyPrayer, [string, string]> = {
  fajr: ['03:00', '08:30'],
  dhuhr: ['11:00', '15:30'],
  asr: ['13:00', '20:00'],
  maghrib: ['15:00', '22:30'],
  isha: ['17:00', '23:59'],
};

const DAILY_PRAYERS = Object.keys(PRAYER_MARKERS) as DailyPrayer[];

function normalizeWebsite(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function candidateUrls(website: string): string[] {
  const root = normalizeWebsite(website);
  if (!root) return [];
  let base: URL;
  try {
    base = new URL(root);
  } catch {
    return [];
  }
  const hostname = base.hostname.toLowerCase();
  if (DIRECTORY_DOMAINS.has(hostname) || LOW_VALUE_DOMAINS.has(hostname)) return [];
  const urls = new Set<string>([base.toString()]);
  for (const p of COMMON_PATHS) urls.add(new URL(p, base.origin).toString());
  return Array.from(urls);
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(tr|li|p|div|section|article|h[1-6])>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&quot;/g, '"')
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function discoverTimingLinks(html: string, pageUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }

  const out = new Set<string>();
  const attr = /\b(?:href|src)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = attr.exec(html))) {
    const value = match[1];
    if (!value || /^(mailto:|tel:|javascript:|#)/i.test(value)) continue;
    let url: URL;
    try {
      url = new URL(value, base);
    } catch {
      continue;
    }
    const href = url.toString();
    const haystack = `${href} ${value}`.toLowerCase();
    if (!/(prayer|salah|salat|iqama|iqamah|jumu|jumma|friday|timetable|time)/.test(haystack)) {
      continue;
    }
    const hostname = url.hostname.toLowerCase();
    if (LOW_VALUE_DOMAINS.has(hostname)) continue;
    if (hostname !== base.hostname && !/(mawaqit|masjidi|masjidbox|salah|prayer)/i.test(hostname)) {
      continue;
    }
    out.add(href);
  }
  return Array.from(out).slice(0, 4);
}

function minutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function inRange(time: string, [start, end]: [string, string]): boolean {
  const value = minutes(time);
  return value >= minutes(start) && value <= minutes(end);
}

function timeHits(text: string): TimeHit[] {
  return Array.from(
    text.matchAll(/\b(?:\d{1,2}[:.]\d{2}\s*(?:AM|PM|am|pm)?|\d{1,2}\s*(?:AM|PM|am|pm))\b/g),
  )
    .map(m => ({ raw: m[0], time: normalizeTime(m[0]), index: m.index ?? 0 }))
    .filter((hit): hit is TimeHit => !!hit.time);
}

function linesFromText(text: string): string[] {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
}

function isDailyPrayerLine(line: string): boolean {
  return DAILY_PRAYERS.some(prayer => PRAYER_MARKERS[prayer].test(line));
}

function isStopLine(line: string): boolean {
  return isDailyPrayerLine(line) || /\b(events?|monthly schedule|download schedule|donate|contact)\b/i.test(line);
}

function blockFrom(lines: string[], startIndex: number, maxLines: number, stopAfterTime: boolean): string {
  const block: string[] = [];
  let sawTime = false;
  for (let i = startIndex; i < Math.min(lines.length, startIndex + maxLines); i++) {
    const line = lines[i];
    if (i > startIndex && stopAfterTime && sawTime && isStopLine(line)) break;
    block.push(line);
    if (timeHits(line).length > 0) sawTime = true;
  }
  return block.join('\n');
}

function extractJummahTimes(text: string): { times: string[]; matchedText: string } | null {
  const lines = linesFromText(text);
  const marker = /\b(jumu'?ah|jumu’ah|jummah|jumma|juma|friday prayer|friday prayers|friday prayer timings)\b/i;

  for (let i = 0; i < lines.length; i++) {
    if (!marker.test(lines[i])) continue;
    const block = blockFrom(lines, i, 14, true);
    const times = timeHits(block)
      .map(hit => hit.time)
      .filter(time => time >= '11:00' && time <= '16:30');
    const unique = normalizeJummahTimes(times);
    if (unique.length > 0) return { times: unique, matchedText: block.slice(0, 500) };
  }
  return null;
}

function hasIqamaContext(text: string): boolean {
  return /\b(iqama|iqamah|jamat|jamaat|congregation)\b/i.test(text);
}

function choosePrayerTime(block: string, prayer: DailyPrayer): string | null {
  if (!PRAYER_MARKERS[prayer].test(block)) return null;
  if (/\b(jumu'?ah|jumu’ah|jummah|jumma|juma|friday|eid)\b/i.test(block)) return null;
  if (/\b(sunrise|shuruq|ishraq|sehri|suhoor|iftar)\b/i.test(block) && !hasIqamaContext(block)) {
    return null;
  }

  const candidates = timeHits(block).filter(hit => inRange(hit.time, PRAYER_RANGES[prayer]));
  if (candidates.length === 0) return null;

  const iqama = block.search(/\b(iqama|iqamah|jamat|jamaat|congregation)\b/i);
  if (iqama >= 0) {
    const after = candidates.find(hit => hit.index > iqama);
    if (after) return after.time;
  }

  if (/\b(adhan|azan|begins?|starts?|start time|prayer starts?|ends?)\b/i.test(block) && candidates.length === 1) {
    return null;
  }

  return candidates[candidates.length - 1].time;
}

function extractDailyTimings(text: string): { timings: OtherTimings; matchedLines: string[] } {
  const timings: OtherTimings = {};
  const matchedLines: string[] = [];
  const lines = linesFromText(text).filter(line => line.length <= 260);

  for (let i = 0; i < lines.length; i++) {
    for (const prayer of DAILY_PRAYERS) {
      if (timings[prayer] || !PRAYER_MARKERS[prayer].test(lines[i])) continue;
      const block = blockFrom(lines, i, 8, true);
      if (prayer === 'maghrib' && timings.maghribOffset == null) {
        const maghribOffset = block.match(/\bmaghrib\b[\s\S]*?\b(\d{1,2})\s*(?:min|mins|minutes)\b[\s\S]*?\b(after|following)\b/i);
        if (maghribOffset) {
          timings.maghribOffset = Number(maghribOffset[1]);
          matchedLines.push(block);
          continue;
        }
      }

      const time = choosePrayerTime(block, prayer);
      if (!time) continue;
      timings[prayer] = time;
      matchedLines.push(block);
    }
  }

  return { timings, matchedLines: Array.from(new Set(matchedLines)).slice(0, 8) };
}

function extractPageTimings(text: string): { jummah: string[]; otherTimings: OtherTimings; matchedText: string } | null {
  const jummah = extractJummahTimes(text);
  const daily = extractDailyTimings(text);
  const dailyCount = Object.keys(daily.timings).length;
  if (!jummah && dailyCount < 3) return null;
  return {
    jummah: jummah?.times || [],
    otherTimings: daily.timings,
    matchedText: [jummah?.matchedText, ...daily.matchedLines].filter(Boolean).join('\n').slice(0, 1200),
  };
}

export function createWebsiteSource(opts: WebsiteOptions = {}): ScraperSource {
  const timeoutMs = opts.timeoutMs ?? Number(process.env.WEBSITE_SCRAPER_TIMEOUT_MS || 4_000);
  const maxFetchesPerSite = Math.max(
    1,
    Number(process.env.WEBSITE_SCRAPER_MAX_FETCHES || DEFAULT_MAX_FETCHES_PER_SITE),
  );

  async function fetchText(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error(`unsupported content-type ${contentType || 'unknown'}`);
      }
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: 'Masjid website',
    scraperUser: MASJID_WEBSITE_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      if (!local.website) return null;
      const urls = candidateUrls(local.website);
      const seen = new Set<string>();
      let fetches = 0;
      let bestMatch: SourceMatch | null = null;
      let bestRichness = -1;
      for (let i = 0; i < urls.length && fetches < maxFetchesPerSite; i++) {
        const url = urls[i];
        if (seen.has(url)) continue;
        seen.add(url);
        fetches++;
        let html: string;
        try {
          html = await fetchText(url);
        } catch {
          continue; // Many masjid sites do not expose every common path.
        }
        for (const linked of discoverTimingLinks(html, url)) {
          if (!seen.has(linked)) urls.splice(i + 1, 0, linked);
        }
        const extracted = extractPageTimings(htmlToText(html));
        if (!extracted) continue;
        const otherTimings =
          Object.keys(extracted.otherTimings).length > 0 ? extracted.otherTimings : undefined;
        const candidate: SourceMatch = {
          sourceName: 'Masjid website',
          sourceUrl: url,
          sourceMosqueName: local.name,
          // The masjid's own site is authoritative on identity, so no geo match
          // is needed — confidence is 1.
          matchScore: 1,
          jummah: extracted.jummah,
          otherTimings,
          extraNotes: [`Matched text: ${extracted.matchedText}`],
        };
        const richness = extracted.jummah.length * 3 + Object.keys(extracted.otherTimings).length;
        if (richness > bestRichness) {
          bestMatch = candidate;
          bestRichness = richness;
        }
      }
      return bestMatch;
    },
  };
}
