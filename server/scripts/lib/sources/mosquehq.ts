/**
 * MosqueHQ source - public search endpoint + visible mosque pages.
 *
 * Search uses MosqueHQ's public `/filter` form endpoint with the page CSRF
 * token and session cookies. Timings are parsed from the mosque page's visible
 * table / JS payload. Submitted under "MayAllahRewardMosqueHQ.com".
 */

import {
  ScraperSource,
  SourceMatch,
  LocalMosque,
  OtherTimings,
  MOSQUEHQ_SCRAPER_IDENTITY,
  USER_AGENT,
  fetchText,
  scoreMatch,
  normalizeTime,
  normalizeJummahTimes,
} from '../jummah-import-core';

const BASE_URL = 'https://www.mosquehq.com';
const SOURCE_NAME = 'MosqueHQ';

type MosqueHqSearchRow = {
  id?: number;
  distance?: string | number;
  name?: string;
  address?: string;
  address_lat?: string | number;
  address_lng?: string | number;
  slug?: string;
  url?: string;
};

type MosqueHqSession = {
  csrfToken: string;
  cookieHeader: string;
};

type DailyPrayer = Exclude<keyof OtherTimings, 'maghribOffset'>;

export type MosqueHqPageTimings = {
  mosqueName?: string;
  timezone?: string;
  jummah: string[];
  otherTimings: OtherTimings;
};

export type MosqueHqOptions = {
  maxDistanceKm: number;
  minScore: number;
  timeoutMs?: number;
  radiusMiles?: number;
};

function cleanText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function asNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractCsrfToken(html: string): string | null {
  return (
    html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/X-CSRF-TOKEN["']?\s*:\s*["']([^"']+)["']/i)?.[1] ||
    null
  );
}

function splitSetCookie(value: string): string[] {
  return value.split(/,(?=\s*(?:XSRF-TOKEN|laravel_session)=)/i).map(v => v.trim()).filter(Boolean);
}

function cookieHeaderFrom(headers: Headers): string {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = withGetSetCookie.getSetCookie
    ? withGetSetCookie.getSetCookie()
    : headers.get('set-cookie')
      ? splitSetCookie(headers.get('set-cookie')!)
      : [];
  return setCookies
    .map(cookie => cookie.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function extractStringArray(html: string, variableName: string): string[] {
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`var\\s+${escaped}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;`, 'i'));
  if (!match) return [];
  return Array.from(match[1].matchAll(/['"]([^'"]*)['"]/g)).map(m => m[1].trim()).filter(Boolean);
}

function extractJsonObjectAfter(html: string, marker: string): any | null {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const braceStart = html.indexOf('{', start);
  if (braceStart < 0) return null;
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
          return JSON.parse(html.slice(braceStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(cell => cleanText(cell[1]));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

export function extractMosqueHqTimings(html: string): MosqueHqPageTimings {
  const otherTimings: OtherTimings = {};
  const todayIqamah = extractStringArray(html, 'today_iqamah').map(normalizeTime);
  const prayers: DailyPrayer[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  for (let i = 0; i < prayers.length; i++) {
    const time = todayIqamah[i];
    if (time) otherTimings[prayers[i]] = time;
  }

  let jummah = normalizeJummahTimes([]);
  const settings = extractJsonObjectAfter(html, 'mosque_settings =');
  if (settings) {
    jummah = normalizeJummahTimes(settings.jummah_iqamah_time || settings.jummah_adhan_time || []);
  }

  if (Object.keys(otherTimings).length < 5 || jummah.length === 0) {
    for (const cells of extractRows(html)) {
      const label = cells[0] || '';
      const iqamah = cells[2] || cells[cells.length - 1] || '';
      if (/^fajr\b/i.test(label)) otherTimings.fajr ||= normalizeTime(iqamah) || undefined;
      else if (/^dhuhr\b|^zuhr\b/i.test(label)) otherTimings.dhuhr ||= normalizeTime(iqamah) || undefined;
      else if (/^as[ar]\b/i.test(label)) otherTimings.asr ||= normalizeTime(iqamah) || undefined;
      else if (/^maghrib\b/i.test(label)) otherTimings.maghrib ||= normalizeTime(iqamah) || undefined;
      else if (/^isha/i.test(label)) otherTimings.isha ||= normalizeTime(iqamah) || undefined;
      else if (/jumm?u?ah|jummah|friday/i.test(label) && jummah.length === 0) {
        jummah = normalizeJummahTimes([iqamah, cells[1]]);
      }
    }
  }

  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s*\|\s*MosqueHQ\s*$/i, '');
  const timezone =
    html.match(/mosque_settings\.timezone\s*=\s*["']([^"']+)["']/i)?.[1] ||
    html.match(/\(([A-Za-z_]+\/[A-Za-z_\-]+)\)/)?.[1];
  return {
    mosqueName: title || undefined,
    timezone,
    jummah,
    otherTimings,
  };
}

export function createMosqueHqSource(opts: MosqueHqOptions): ScraperSource {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const radiusMiles = opts.radiusMiles ?? 5;
  let sessionPromise: Promise<MosqueHqSession> | null = null;

  async function loadSession(): Promise<MosqueHqSession> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(BASE_URL, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      });
      if (!res.ok) throw new Error(`MosqueHQ home returned ${res.status}`);
      const html = await res.text();
      const csrfToken = extractCsrfToken(html);
      if (!csrfToken) throw new Error('MosqueHQ CSRF token not found');
      return { csrfToken, cookieHeader: cookieHeaderFrom(res.headers) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function session(): Promise<MosqueHqSession> {
    sessionPromise ||= loadSession();
    return sessionPromise;
  }

  async function search(local: LocalMosque, retry = true): Promise<MosqueHqSearchRow[]> {
    const current = await session();
    const body = new URLSearchParams({
      address: '',
      radius: String(radiusMiles),
      lat: String(local.latitude),
      lng: String(local.longitude),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE_URL}/filter`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-CSRF-TOKEN': current.csrfToken,
          'X-Requested-With': 'XMLHttpRequest',
          ...(current.cookieHeader ? { Cookie: current.cookieHeader } : {}),
        },
        body,
      });
      if (res.status === 419 && retry) {
        sessionPromise = null;
        return search(local, false);
      }
      if (!res.ok) throw new Error(`MosqueHQ filter returned ${res.status}`);
      const data = (await res.json()) as { code?: number; list?: { data?: MosqueHqSearchRow[] } };
      return data.code === 11 && Array.isArray(data.list?.data) ? data.list.data : [];
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: SOURCE_NAME,
    scraperUser: MOSQUEHQ_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      const scored = (await search(local))
        .map(row => {
          const distanceKm = asNumber(row.distance) ?? Number.POSITIVE_INFINITY;
          const { matchScore } = scoreMatch(local.name, row.name || '', distanceKm, opts.maxDistanceKm);
          return { row, distanceKm, matchScore };
        })
        .filter(row => row.distanceKm <= opts.maxDistanceKm && row.matchScore >= opts.minScore && !!row.row.url)
        .sort((a, b) => b.matchScore - a.matchScore || a.distanceKm - b.distanceKm)
        .slice(0, 3);

      for (const row of scored) {
        const sourceUrl = row.row.url!;
        let html: string;
        try {
          html = await fetchText(sourceUrl, timeoutMs);
        } catch {
          continue;
        }
        const timings = extractMosqueHqTimings(html);
        const hasOther = Object.keys(timings.otherTimings).length > 0;
        if (timings.jummah.length === 0 && !hasOther) continue;
        return {
          sourceName: SOURCE_NAME,
          sourceUrl,
          websiteUrl: null,
          sourceMosqueName: timings.mosqueName || row.row.name,
          sourceMosqueId: row.row.id,
          matchScore: row.matchScore,
          distanceKm: row.distanceKm,
          jummah: timings.jummah,
          otherTimings: hasOther ? timings.otherTimings : undefined,
          extraNotes: [
            `Friday + daily iqamah schedule read from public MosqueHQ page${timings.timezone ? ` (${timings.timezone})` : ''}.`,
          ],
        };
      }
      return null;
    },
  };
}
