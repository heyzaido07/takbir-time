/**
 * Jamaat360 source — jamaat360.com is a crowd-sourced mosque directory with
 * good coverage in Pakistan and the South-Asian diaspora.
 *
 * Its nearby endpoint returns candidate mosques by lat/lng; each candidate's
 * page carries the Jummah time (plus a JSON-LD Mosque schema). Submitted under
 * the dedicated time keeper "MayAllahRewardJamaat360.com".
 */

import {
  ScraperSource,
  SourceMatch,
  LocalMosque,
  JAMAAT360_SCRAPER_IDENTITY,
  USER_AGENT,
  scoreMatch,
  normalizeTime,
} from '../jummah-import-core';

const BASE_URL = 'https://jamaat360.com';
const NEARBY_URL = `${BASE_URL}/api/nearby`;

type NearbyMosque = {
  id: number;
  name: string;
  location?: string;
  city?: string;
  distance: number; // km
  times?: { jumma?: string };
  url: string;
};

export type Jamaat360Options = {
  maxDistanceKm: number;
  minScore: number;
  includePlaceholders: boolean;
  timeoutMs?: number;
};

function absoluteUrl(url: string): string {
  return url.startsWith('http') ? url : `${BASE_URL}${url}`;
}

function parseMosqueSchema(html: string): any | null {
  const scripts =
    html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const script of scripts) {
    const body = script
      .replace(/^<script[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();
    try {
      const parsed = JSON.parse(body);
      if (parsed?.['@type'] === 'Mosque') return parsed;
    } catch {
      // Ignore non-JSON-LD script bodies.
    }
  }
  return null;
}

export function createJamaat360Source(opts: Jamaat360Options): ScraperSource {
  const timeoutMs = opts.timeoutMs ?? 15_000;

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, ...(init?.headers || {}) },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${url} returned ${res.status}: ${body.slice(0, 160)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchText(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchNearby(local: LocalMosque): Promise<NearbyMosque[]> {
    const data = await fetchJson<{ status: string; data?: NearbyMosque[] }>(NEARBY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: local.latitude,
        longitude: local.longitude,
        clientLocalMinutes: 13 * 60,
      }),
    });
    if (data.status !== 'success' || !Array.isArray(data.data)) return [];
    const seen = new Set<number>();
    const unique: NearbyMosque[] = [];
    for (const row of data.data) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      unique.push(row);
    }
    return unique;
  }

  return {
    name: 'Jamaat360',
    scraperUser: JAMAAT360_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      const nearby = await fetchNearby(local);
      const scored = nearby
        .filter(row => Number(row.distance) <= opts.maxDistanceKm)
        .filter(row => !!normalizeTime(row.times?.jumma))
        .map(row => ({
          row,
          ...scoreMatch(local.name, row.name, Number(row.distance), opts.maxDistanceKm),
        }))
        .filter(row => row.matchScore >= opts.minScore)
        .sort((a, b) => b.matchScore - a.matchScore || a.row.distance - b.row.distance)
        .slice(0, 3);

      for (const scoredRow of scored) {
        const sourceUrl = absoluteUrl(scoredRow.row.url);
        let html: string;
        try {
          html = await fetchText(sourceUrl);
        } catch {
          continue;
        }
        const schema = parseMosqueSchema(html);
        const tableTime = html.match(
          /<td[^>]*>\s*Jumma\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/i,
        )?.[1];
        const jummah = normalizeTime(tableTime) || normalizeTime(scoredRow.row.times?.jumma);
        if (!jummah) continue;

        const timesNeedUpdate =
          html.includes('Prayer times need verification') ||
          /"timesNeedUpdate"\s*:\s*true/.test(html);
        if (timesNeedUpdate && !opts.includePlaceholders) continue;

        return {
          sourceName: 'Jamaat360',
          sourceUrl,
          sourceMosqueName: (schema?.name || scoredRow.row.name || '').trim() || undefined,
          sourceMosqueId: scoredRow.row.id,
          matchScore: scoredRow.matchScore,
          distanceKm: Number(scoredRow.row.distance),
          jummah: [jummah],
          extraNotes: timesNeedUpdate
            ? ['Source page is flagged as needing verification (imported with --include-placeholders).']
            : undefined,
        };
      }
      return null;
    },
  };
}
