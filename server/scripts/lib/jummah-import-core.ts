/**
 * Shared core for the Jummah / prayer-time importers.
 *
 * Every scraper source (Mawaqit, Jamaat360, direct masjid websites) plugs into
 * this core: it owns local-mosque loading, name/distance match scoring, time
 * normalization, the bootstrap "default scraped time" user, progress files,
 * and the TimingSubmission + PrayerSchedule write path.
 *
 * A source only has to implement `ScraperSource.findMatch(localMosque)`.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';

export const USER_AGENT = 'TakbeerTime-JummahImporter/1.0 (+https://takbeertime.com)';
export const MAX_JUMMAH_TIMES = 3;

/** Identity a source submits timings under (its public "time keeper" username). */
export type ScraperUserIdentity = { email: string; fullName: string };

/** Generic bootstrap user — used by sources that do not declare their own. */
export const DEFAULT_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.JUMMAH_SCRAPER_USER_EMAIL || 'default-scraped-time@takbeertime.local',
  fullName: process.env.JUMMAH_SCRAPER_USER_NAME || 'default scraped time',
};

/** Dedicated time keeper for Mawaqit-sourced timings. */
export const MAWAQIT_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.MAWAQIT_TIMEKEEPER_EMAIL || 'mawaqit-timekeeper@takbeertime.local',
  fullName: process.env.MAWAQIT_TIMEKEEPER_NAME || 'MayAllahRewardMawaqit.net',
};

/** Dedicated time keeper for Masjidi-sourced timings. */
export const MASJIDI_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.MASJIDI_TIMEKEEPER_EMAIL || 'masjidi-timekeeper@takbeertime.local',
  fullName: process.env.MASJIDI_TIMEKEEPER_NAME || 'MayAllahRewardMasjidiTeam',
};

/** Dedicated time keeper for Jamaat360-sourced timings. */
export const JAMAAT360_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.JAMAAT360_TIMEKEEPER_EMAIL || 'jamaat360-timekeeper@takbeertime.local',
  fullName: process.env.JAMAAT360_TIMEKEEPER_NAME || 'MayAllahRewardJamaat360.com',
};

/** Dedicated time keeper for timings read from a masjid's own public website. */
export const MASJID_WEBSITE_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.MASJID_WEBSITE_TIMEKEEPER_EMAIL || 'masjid-website-timekeeper@takbeertime.local',
  fullName: process.env.MASJID_WEBSITE_TIMEKEEPER_NAME || 'MayAllahRewardMasjidWebsiteAdmins',
};

/** Dedicated time keeper for FivePrayers-sourced timings. */
export const FIVEPRAYERS_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.FIVEPRAYERS_TIMEKEEPER_EMAIL || 'fiveprayers-timekeeper@takbeertime.local',
  fullName: process.env.FIVEPRAYERS_TIMEKEEPER_NAME || 'MayAllahRewardFivePrayers.org',
};

/** Dedicated time keeper for MosqueHQ-sourced timings. */
export const MOSQUEHQ_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.MOSQUEHQ_TIMEKEEPER_EMAIL || 'mosquehq-timekeeper@takbeertime.local',
  fullName: process.env.MOSQUEHQ_TIMEKEEPER_NAME || 'MayAllahRewardMosqueHQ.com',
};

/** Official JAKIM e-Solat daily prayer-start times for Malaysia. */
export const JAKIM_ESOLAT_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.JAKIM_ESOLAT_TIMEKEEPER_EMAIL || 'jakim-esolat-timekeeper@takbeertime.local',
  fullName: process.env.JAKIM_ESOLAT_TIMEKEEPER_NAME || 'MayAllahRewardJAKIMeSolat',
};

/** Official MUIS daily prayer-start times for Singapore. */
export const MUIS_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.MUIS_TIMEKEEPER_EMAIL || 'muis-timekeeper@takbeertime.local',
  fullName: process.env.MUIS_TIMEKEEPER_NAME || 'MayAllahRewardMUIS',
};

/** Official Vaktija.ba daily prayer-start times for Bosnia/Sandzak locations. */
export const VAKTIJA_BA_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.VAKTIJA_BA_TIMEKEEPER_EMAIL || 'vaktija-ba-timekeeper@takbeertime.local',
  fullName: process.env.VAKTIJA_BA_TIMEKEEPER_NAME || 'MayAllahRewardVaktija.ba',
};

/** Official Dubai IACAD daily prayer-start times. */
export const IACAD_DUBAI_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.IACAD_DUBAI_TIMEKEEPER_EMAIL || 'iacad-dubai-timekeeper@takbeertime.local',
  fullName: process.env.IACAD_DUBAI_TIMEKEEPER_NAME || 'MayAllahRewardDubaiIACAD',
};

/** Official Morocco Habous daily prayer-start times. */
export const MOROCCO_HABOUS_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.MOROCCO_HABOUS_TIMEKEEPER_EMAIL || 'morocco-habous-timekeeper@takbeertime.local',
  fullName: process.env.MOROCCO_HABOUS_TIMEKEEPER_NAME || 'MayAllahRewardMoroccoHabous',
};

/** Official Diyanet/Awqat Salah daily prayer-start times. Requires configured API credentials. */
export const DIYANET_AWQAT_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.DIYANET_AWQAT_TIMEKEEPER_EMAIL || 'diyanet-awqat-timekeeper@takbeertime.local',
  fullName: process.env.DIYANET_AWQAT_TIMEKEEPER_NAME || 'MayAllahRewardDiyanet',
};

/** Indonesia Kemenag/Bimas Islam daily prayer-start times. */
export const KEMENAG_BIMAS_SCRAPER_IDENTITY: ScraperUserIdentity = {
  email: process.env.KEMENAG_BIMAS_TIMEKEEPER_EMAIL || 'kemenag-bimas-timekeeper@takbeertime.local',
  fullName: process.env.KEMENAG_BIMAS_TIMEKEEPER_NAME || 'MayAllahRewardKemenagBimasIslam',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LocalMosque = {
  id: string;
  name: string;
  city: string;
  country: string;
  stateProvince: string | null;
  postalCode: string | null;
  latitude: number;
  longitude: number;
  website: string | null;
};

/** Fixed daily congregation (iqamah) times a source may also expose. */
export type OtherTimings = {
  fajr?: string;
  dhuhr?: string;
  asr?: string;
  maghrib?: string;
  isha?: string;
  maghribOffset?: number;
};

/** A confident match between a local mosque and a source record. */
export type SourceMatch = {
  sourceName: string;
  sourceUrl: string;
  /**
   * Public masjid/site URL to save onto mosques.website when the local record
   * is empty. Undefined preserves legacy behavior and saves sourceUrl; null
   * means this source did not provide a public website worth saving.
   */
  websiteUrl?: string | null;
  sourceMosqueName?: string;
  sourceMosqueId?: string | number;
  matchScore: number;
  distanceKm?: number;
  /** Ordered Jummah times. The write path normalizes and stores at most 3. */
  jummah: string[];
  otherTimings?: OtherTimings;
  extraNotes?: string[];
};

export interface ScraperSource {
  /** Stable label, also used as the PrayerSchedule.scheduleName suffix. */
  readonly name: string;
  /** Public time keeper this source submits under; defaults to the generic bootstrap user. */
  readonly scraperUser?: ScraperUserIdentity;
  findMatch(local: LocalMosque): Promise<SourceMatch | null>;
}

export type CoreArgs = {
  sources: string[];
  apply: boolean;
  resume: boolean;
  refresh: boolean;
  submissionsOnly: boolean;
  replaceVerified: boolean;
  includeTestRows: boolean;
  includePlaceholders: boolean;
  global: boolean;
  country?: string;
  city?: string;
  name?: string;
  mosqueId?: string;
  limit?: number;
  offset: number;
  concurrency: number;
  delayMs: number;
  minScore: number;
  maxDistanceKm: number;
  websiteOnly: boolean;
  /** When set on a --global run, restricts scanning to these countries (the proven-yield allow-list). */
  scrapeCountries?: string[];
};

export type Progress = {
  startedAt: string;
  updatedAt: string;
  source: string;
  scope: string;
  total: number;
  scanned: number;
  matched: number;
  written: number;
  processedCount: number;
  skipped: Record<string, number>;
  examples: Array<Record<string, unknown>>;
};

export type WriteResult = 'written' | 'duplicate' | 'same-schedule' | 'verified-conflict';

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

export function normalizeName(input: string | null | undefined): string {
  return (input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(masjid|mosque|mosq|jamia|jamiya|jame|jama|juma|jumma|al|ul|e|bin|ibn|ra|r\.a)\b/g, ' ')
    .replace(/\b(town|block|sector|phase|colony|society|road|rd|street|st|avenue|ave|markaz|bazar|bazaar|chowk)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(input: string): Set<string> {
  return new Set(normalizeName(input).split(' ').filter(t => t.length >= 2));
}

function tokenOverlap(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / Math.max(left.size, right.size);
}

function bigrams(value: string): Set<string> {
  const n = normalizeName(value).replace(/\s+/g, '');
  if (n.length < 2) return new Set(n ? [n] : []);
  const grams = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) grams.add(n.slice(i, i + 2));
  return grams;
}

function diceSimilarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared++;
  return (2 * shared) / (left.size + right.size);
}

export function nameSimilarity(a: string, b: string): number {
  return Math.max(tokenOverlap(a, b), diceSimilarity(a, b));
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function scoreDistance(distanceKm: number, maxDistanceKm: number): number {
  if (distanceKm <= 0.03) return 1;
  if (distanceKm >= maxDistanceKm) return 0;
  return Math.max(0, 1 - (distanceKm - 0.03) / (maxDistanceKm - 0.03));
}

/**
 * Blended name + distance confidence. OSM bulk-imported mosques frequently have
 * generic placeholder names ("Mosque (OSM node 123)"); for those a very close
 * source record is trusted on proximity alone.
 */
export function scoreMatch(
  localName: string,
  sourceName: string,
  distanceKm: number,
  maxDistanceKm: number,
): { nameScore: number; distanceScore: number; matchScore: number } {
  const nameScore = nameSimilarity(localName, sourceName);
  const distanceScore = scoreDistance(distanceKm, maxDistanceKm);
  const localNameIsGeneric =
    normalizeName(localName) === '' || /\bOSM (node|way|relation)\b/i.test(localName);
  let matchScore = 0.62 * distanceScore + 0.38 * nameScore;
  if (localNameIsGeneric && distanceKm <= 0.03 && sourceName.trim()) {
    matchScore = Math.max(matchScore, 0.82);
  }
  if (localNameIsGeneric && distanceKm <= 0.01 && sourceName.trim()) {
    matchScore = Math.max(matchScore, 0.9);
  }
  return { nameScore, distanceScore, matchScore };
}

// ---------------------------------------------------------------------------
// Time normalization
// ---------------------------------------------------------------------------

/** Accepts "13:30", "1:30 PM", "1.30pm", "13:30:00" -> "HH:MM" (24h) or null. */
export function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim().replace(/\./g, ':').toUpperCase();
  const match = raw.match(/\b(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || '00');
  const period = match[3];
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
  }
  if (hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function normalizeJummahTimes(
  values: readonly unknown[],
  maxTimes = MAX_JUMMAH_TIMES,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (out.length >= maxTimes) break;
    const time =
      typeof value === 'string' || typeof value === 'number'
        ? normalizeTime(String(value))
        : null;
    if (!time || seen.has(time)) continue;
    seen.add(time);
    out.push(time);
  }
  return out;
}

/** Adds an offset (minutes) to a "HH:MM" time, wrapping within a day. */
export function addMinutes(time: string, minutes: number): string | null {
  const t = normalizeTime(time);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  let total = (h * 60 + m + minutes) % (24 * 60);
  if (total < 0) total += 24 * 60;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export async function fetchText(url: string, timeoutMs = 12_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<T> {
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

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  delayMs: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        await worker(items[index], index);
        if (delayMs > 0) await sleep(delayMs);
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Scraper user + local mosque loading
// ---------------------------------------------------------------------------

export async function getScraperUser(
  prisma: PrismaClient,
  identity: ScraperUserIdentity = DEFAULT_SCRAPER_IDENTITY,
) {
  return prisma.user.upsert({
    where: { email: identity.email },
    update: { fullName: identity.fullName },
    create: {
      email: identity.email,
      fullName: identity.fullName,
      reputationPoints: 0,
      verifiedContributor: false,
    },
  });
}

const TEST_ROW_NAME_FRAGMENTS = ['E2E', 'Test Mosque', 'Suggestion Test', 'New-Suggestion-Hook', 'QA '];

/** PrayerSchedule.scheduleName values written per source — used for --refresh scoping. */
export const SCHEDULE_NAME_BY_SOURCE: Record<string, string> = {
  mawaqit: 'Scraped from Mawaqit',
  jamaat360: 'Scraped from Jamaat360',
  masjidi: 'Scraped from Masjidi',
  fiveprayers: 'Scraped from FivePrayers',
  mosquehq: 'Scraped from MosqueHQ',
  websites: 'Scraped from Masjid website',
  jakim: 'Scraped from JAKIM e-Solat',
  muis: 'Scraped from MUIS',
  vaktija: 'Scraped from Vaktija.ba',
  iacad: 'Scraped from Dubai IACAD',
  habous: 'Scraped from Morocco Habous',
  diyanet: 'Scraped from Diyanet Awqat Salah',
  kemenag: 'Scraped from Kemenag Bimas Islam',
};

export async function loadMosques(prisma: PrismaClient, args: CoreArgs): Promise<LocalMosque[]> {
  const where: Prisma.MosqueWhereInput = { deletedAt: null, status: 'active' };
  if (args.country && !args.global) where.country = { equals: args.country, mode: 'insensitive' };
  // --global is restricted to the proven-yield allow-list unless --all-countries is passed.
  if (args.global && args.scrapeCountries && args.scrapeCountries.length > 0) {
    where.country = { in: args.scrapeCountries };
  }
  if (args.mosqueId) where.id = args.mosqueId;
  if (args.name) where.name = { contains: args.name, mode: 'insensitive' };
  if (args.city) where.city = { contains: args.city, mode: 'insensitive' };
  if (args.websiteOnly) where.website = { not: null };
  if (!args.includeTestRows) {
    where.NOT = TEST_ROW_NAME_FRAGMENTS.map(fragment => ({
      name: { contains: fragment, mode: 'insensitive' as Prisma.QueryMode },
    }));
  }

  // --refresh: only re-process mosques whose currently-active schedule was
  // written by one of the selected scraper sources.
  if (args.refresh) {
    const scheduleNames = args.sources
      .map(source => SCHEDULE_NAME_BY_SOURCE[source])
      .filter((value): value is string => !!value);
    if (scheduleNames.length > 0) {
      where.prayerSchedules = {
        some: { isActive: true, deletedAt: null, scheduleName: { in: scheduleNames } },
      };
    }
  }

  return prisma.mosque.findMany({
    where,
    orderBy: [{ country: 'asc' }, { city: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    skip: args.mosqueId ? 0 : args.offset,
    take: args.limit,
    select: {
      id: true,
      name: true,
      city: true,
      country: true,
      stateProvince: true,
      postalCode: true,
      latitude: true,
      longitude: true,
      website: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

export function buildSourceNote(
  local: LocalMosque,
  match: SourceMatch,
  scrapedAt: Date,
  scraperName: string,
): string {
  return [
    `Source: ${match.sourceName}`,
    `Source URL: ${match.sourceUrl}`,
    match.sourceMosqueId != null ? `Source mosque ID: ${match.sourceMosqueId}` : null,
    match.sourceMosqueName ? `Source mosque name: ${match.sourceMosqueName}` : null,
    `Local mosque: ${local.name} (${local.city}, ${local.country})`,
    `Match score: ${match.matchScore.toFixed(3)}`,
    match.distanceKm != null ? `Source distance km: ${match.distanceKm.toFixed(3)}` : null,
    `Scraped at: ${scrapedAt.toISOString()}`,
    ...(match.extraNotes || []),
    match.websiteUrl === null
      ? 'This source did not provide a public masjid website to save.'
      : `If the local masjid record has no website, ${match.websiteUrl || match.sourceUrl} is saved to mosques.website.`,
    `Submitted by automated time keeper "${scraperName}". Disable future runs with JUMMAH_SCRAPER_ENABLED=false.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function writeMatch(
  prisma: PrismaClient,
  local: LocalMosque,
  match: SourceMatch,
  userId: string,
  scraperName: string,
  args: CoreArgs,
): Promise<WriteResult> {
  const scrapedAt = new Date();
  const other = stripUndefined((match.otherTimings || {}) as Record<string, unknown>);
  const jummah = normalizeJummahTimes(match.jummah);
  const hasJummah = jummah.length > 0;
  const submissionTimings: Record<string, unknown> = { ...other };
  if (hasJummah) submissionTimings.jummah = jummah;
  const notes = buildSourceNote(local, match, scrapedAt, scraperName);

  const duplicate = await alreadySubmitted(prisma, local.id, userId, match.sourceUrl, jummah, other);
  if (!duplicate) {
    await prisma.timingSubmission.create({
      data: {
        mosqueId: local.id,
        submittedById: userId,
        timings: submissionTimings as Prisma.InputJsonObject,
        notes,
        proofPhotos: [match.sourceUrl],
        status: 'pending',
        verified: false,
        isVerifiedOnsite: false,
      },
    });
  }

  const websiteUrl = match.websiteUrl === undefined ? match.sourceUrl : match.websiteUrl;
  if (websiteUrl) {
    await prisma.mosque.updateMany({
      where: { id: local.id, website: null },
      data: { website: websiteUrl },
    });
  }

  if (args.submissionsOnly) return duplicate ? 'duplicate' : 'written';

  const current = await prisma.prayerSchedule.findFirst({
    where: { mosqueId: local.id, isActive: true, deletedAt: null },
    orderBy: { validFrom: 'desc' },
  });
  const currentTimings = (current?.timings || {}) as Record<string, unknown>;
  const currentJummah = Array.isArray(currentTimings.jummah)
    ? (currentTimings.jummah as unknown[])
    : currentTimings.jummah
      ? [currentTimings.jummah]
      : [];

  const sameJummah =
    !hasJummah || JSON.stringify(normalizeJummahTimes(currentJummah)) === JSON.stringify(jummah);
  const sameOther = Object.entries(other).every(([key, value]) => currentTimings[key] === value);
  if (sameJummah && sameOther) return duplicate ? 'duplicate' : 'same-schedule';

  if (current?.verificationStatus === 'verified' && !args.replaceVerified) {
    return 'verified-conflict';
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const mergedTimings: Record<string, unknown> = { ...currentTimings, ...other };
  if (hasJummah) mergedTimings.jummah = jummah;

  await prisma.$transaction(async tx => {
    if (current) {
      await tx.prayerSchedule.update({
        where: { id: current.id },
        data: { isActive: false, validUntil: today },
      });
    }
    await tx.prayerSchedule.create({
      data: {
        mosqueId: local.id,
        scheduleName: `Scraped from ${match.sourceName}`,
        timings: mergedTimings as Prisma.InputJsonObject,
        notes,
        submittedById: userId,
        verificationStatus: 'pending',
        validFrom: today,
        isActive: true,
      },
    });
  });

  return duplicate ? 'duplicate' : 'written';
}

async function alreadySubmitted(
  prisma: PrismaClient,
  mosqueId: string,
  userId: string,
  sourceUrl: string,
  jummah: string[],
  other: Record<string, unknown>,
): Promise<boolean> {
  const rows = await prisma.timingSubmission.findMany({
    where: { mosqueId, submittedById: userId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { timings: true, notes: true },
  });
  return rows.some(row => {
    if (!row.notes?.includes(sourceUrl)) return false;
    const timings = (row.timings || {}) as Record<string, unknown>;
    const existing = Array.isArray(timings.jummah)
      ? timings.jummah
      : timings.jummah
        ? [timings.jummah]
        : [];
    const sameJummah = JSON.stringify(normalizeJummahTimes(existing)) === JSON.stringify(jummah);
    const sameOther = Object.entries(other).every(([key, value]) => timings[key] === value);
    return sameJummah && sameOther;
  });
}

// ---------------------------------------------------------------------------
// Progress files
// ---------------------------------------------------------------------------

export function progressFilePath(source: string, scope: string, apply: boolean): string {
  const slug = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
  return path.join(
    __dirname,
    '..',
    '..',
    `jummah-${slug(source)}-import-${slug(scope)}-${apply ? 'apply' : 'dry-run'}.json`,
  );
}

export async function readProgress(file: string): Promise<Progress | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Progress;
  } catch {
    return null;
  }
}

export async function writeProgress(file: string, progress: Progress): Promise<void> {
  progress.updatedAt = new Date().toISOString();
  await fs.writeFile(file, JSON.stringify(progress, null, 2));
}

export function bumpSkipped(progress: Progress, key: string): void {
  progress.skipped[key] = (progress.skipped[key] || 0) + 1;
}
