/**
 * Masjidi source - official Masjidi API (https://api.masjidiapp.com/docs).
 *
 * This source is intentionally opt-in because the production API requires an
 * `apikey` header. Configure MASJIDI_API_KEY, then run:
 *
 *   npx ts-node scripts/import-jummah.ts --source masjidi --country "United States"
 */

import {
  ScraperSource,
  SourceMatch,
  LocalMosque,
  OtherTimings,
  MASJIDI_SCRAPER_IDENTITY,
  USER_AGENT,
  fetchJson,
  haversineKm,
  scoreMatch,
  normalizeTime,
  normalizeJummahTimes,
} from '../jummah-import-core';

const DEFAULT_BASE_URL = 'https://api.masjidiapp.com/v2';
const SOURCE_NAME = 'Masjidi';

type MasjidiMosque = {
  id?: string | number;
  masjid_id?: string | number;
  title?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  web_url?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  distance?: string | number | null;
  fajr_iqama_time?: string | null;
  zuhr_iqama_time?: string | null;
  asr_iqama_time?: string | null;
  isha_iqama_time?: string | null;
  jumma1_azan?: string | null;
  jumma1_iqama?: string | null;
  jumma2_azan?: string | null;
  jumma2_iqama?: string | null;
  jumma3_azan?: string | null;
  jumma3_iqama?: string | null;
};

export type MasjidiOptions = {
  apiKey?: string;
  baseUrl?: string;
  maxDistanceKm: number;
  minScore: number;
  radiusKm?: number;
  timeoutMs?: number;
  limit?: number;
};

function asNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanWebsite(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function jummahCell(value: string | null | undefined): string | null {
  const time = normalizeTime(value);
  if (!time) return null;
  return time >= '11:00' && time <= '16:30' ? time : null;
}

function extractTimings(record: MasjidiMosque): { jummah: string[]; otherTimings: OtherTimings } {
  const otherTimings: OtherTimings = {};
  const fajr = normalizeTime(record.fajr_iqama_time);
  const dhuhr = normalizeTime(record.zuhr_iqama_time);
  const asr = normalizeTime(record.asr_iqama_time);
  const isha = normalizeTime(record.isha_iqama_time);
  if (fajr) otherTimings.fajr = fajr;
  if (dhuhr) otherTimings.dhuhr = dhuhr;
  if (asr) otherTimings.asr = asr;
  if (isha) otherTimings.isha = isha;

  const jummah = normalizeJummahTimes([
    jummahCell(record.jumma1_iqama) || jummahCell(record.jumma1_azan),
    jummahCell(record.jumma2_iqama) || jummahCell(record.jumma2_azan),
    jummahCell(record.jumma3_iqama) || jummahCell(record.jumma3_azan),
  ]);
  return { jummah, otherTimings };
}

function sourceUrl(baseUrl: string, record: MasjidiMosque): string {
  const id = record.masjid_id || record.id;
  return id ? `${baseUrl.replace(/\/+$/, '')}/masjids/${id}` : 'https://api.masjidiapp.com/docs';
}

export function createMasjidiSource(opts: MasjidiOptions): ScraperSource {
  const apiKey: string = opts.apiKey || process.env.MASJIDI_API_KEY || '';
  if (!apiKey) {
    throw new Error('MASJIDI_API_KEY is required for --source masjidi');
  }

  const baseUrl = (opts.baseUrl || process.env.MASJIDI_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const radiusKm = Math.max(1, opts.radiusKm ?? Math.max(3, opts.maxDistanceKm * 10));
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const limit = Math.min(Math.max(1, opts.limit ?? 100), 100);

  async function search(lat: number, lng: number): Promise<MasjidiMosque[]> {
    const params = new URLSearchParams({
      lat: String(lat),
      long: String(lng),
      dist: String(radiusKm),
      limit: String(limit),
    });
    const url = `${baseUrl}/masjids?${params.toString()}`;
    const rows = await fetchJson<unknown>(
      url,
      { headers: { Accept: 'application/json', apikey: apiKey, 'User-Agent': USER_AGENT } },
      timeoutMs,
    );
    return Array.isArray(rows) ? (rows as MasjidiMosque[]) : [];
  }

  return {
    name: SOURCE_NAME,
    scraperUser: MASJIDI_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      const records = await search(local.latitude, local.longitude);
      if (records.length === 0) return null;

      const scored = records
        .map(record => {
          const lat = asNumber(record.latitude);
          const lng = asNumber(record.longitude);
          const distanceKm =
            lat != null && lng != null
              ? haversineKm(local.latitude, local.longitude, lat, lng)
              : Number.POSITIVE_INFINITY;
          const { matchScore } = scoreMatch(
            local.name,
            record.title || '',
            distanceKm,
            opts.maxDistanceKm,
          );
          return { record, distanceKm, matchScore };
        })
        .filter(row => row.distanceKm <= opts.maxDistanceKm && row.matchScore >= opts.minScore)
        .sort((a, b) => b.matchScore - a.matchScore || a.distanceKm - b.distanceKm);

      for (const row of scored) {
        const { jummah, otherTimings } = extractTimings(row.record);
        const hasOther = Object.keys(otherTimings).length > 0;
        if (jummah.length === 0 && !hasOther) continue;

        const website = cleanWebsite(row.record.web_url);
        return {
          sourceName: SOURCE_NAME,
          sourceUrl: website || sourceUrl(baseUrl, row.record),
          websiteUrl: website,
          sourceMosqueName: row.record.title || undefined,
          sourceMosqueId: row.record.masjid_id || row.record.id,
          matchScore: row.matchScore,
          distanceKm: row.distanceKm,
          jummah,
          otherTimings: hasOther ? otherTimings : undefined,
          extraNotes: [
            'Friday times pulled from Masjidi jumma1/jumma2 fields; daily prayers use Masjidi iqama fields only.',
          ],
        };
      }

      return null;
    },
  };
}
