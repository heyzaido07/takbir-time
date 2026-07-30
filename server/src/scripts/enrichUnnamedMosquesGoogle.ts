/**
 * Google Places enrichment for placeholder mosque names.
 *
 * Requires explicit permission to store Google-provided place names.
 *
 * Default mode is dry-run. Pass --apply to update the database.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=... DATABASE_URL=... npm run enrich:google-mosques -- --limit 25
 *   GOOGLE_PLACES_API_KEY=... DATABASE_URL=... npm run enrich:google-mosques -- --limit 25 --apply
 *   GOOGLE_PLACES_API_KEY=... node dist/scripts/enrichUnnamedMosquesGoogle.js --limit 25 --apply
 */

import { Prisma, PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { promises as fs } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

interface MosqueCandidate {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  city: string | null;
  country: string | null;
}

interface GooglePlace {
  id?: string;
  name?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
}

interface ScoredPlace {
  place: GooglePlace;
  name: string;
  distanceMeters: number;
}

interface ResultRow {
  mosqueId: string;
  oldName: string;
  city: string;
  country: string;
  latitude: string;
  longitude: string;
  status: string;
  reason: string;
  googlePlaceId: string;
  googleName: string;
  googleAddress: string;
  distanceMeters: string;
  applied: string;
}

const PLACEHOLDER_SQL = Prisma.sql`
  (
    lower(trim(name)) IN ('unnamed masjid', 'unnamed mosque')
    OR name ~* '^mosque \\(osm (way|node|relation) [0-9]+\\)$'
  )
`;

function argValue(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const direct = process.argv.find((a) => a.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1] || fallback;
  return fallback;
}

function intArg(name: string, fallback: number): number {
  const value = argValue(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function numberArg(name: string, fallback: number): number {
  const value = argValue(name);
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return parsed;
}

function boolArg(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toCsv(rows: ResultRow[]): string {
  const headers: Array<keyof ResultRow> = [
    'mosqueId',
    'oldName',
    'city',
    'country',
    'latitude',
    'longitude',
    'status',
    'reason',
    'googlePlaceId',
    'googleName',
    'googleAddress',
    'distanceMeters',
    'applied',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const radius = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function isGenericName(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return [
    'mosque',
    'masjid',
    'jame masjid',
    'jamia masjid',
    'juma masjid',
    'mousque',
    'unnamed masjid',
    'unnamed mosque',
  ].includes(normalized);
}

async function fetchCandidates(limit: number, country?: string): Promise<MosqueCandidate[]> {
  const countryFilter = country ? Prisma.sql`AND country ILIKE ${country}` : Prisma.empty;
  return prisma.$queryRaw<MosqueCandidate[]>`
    SELECT
      id::text AS id,
      name,
      latitude::float8 AS latitude,
      longitude::float8 AS longitude,
      city,
      country
    FROM mosques
    WHERE deleted_at IS NULL
      AND ${PLACEHOLDER_SQL}
      ${countryFilter}
    ORDER BY updated_at ASC, id ASC
    LIMIT ${limit}
  `;
}

async function searchNearbyMosques(
  apiKey: string,
  mosque: MosqueCandidate,
  radiusMeters: number,
  maxResultCount: number,
  languageCode: string | undefined,
): Promise<GooglePlace[]> {
  const body: Record<string, unknown> = {
    includedTypes: ['mosque'],
    maxResultCount,
    rankPreference: 'DISTANCE',
    locationRestriction: {
      circle: {
        center: {
          latitude: mosque.latitude,
          longitude: mosque.longitude,
        },
        radius: radiusMeters,
      },
    },
  };
  if (languageCode) body.languageCode = languageCode;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.location',
          'places.types',
          'places.primaryType',
          'places.businessStatus',
        ].join(','),
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as { places?: GooglePlace[] };
      return data.places ?? [];
    }

    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 3) {
      throw new Error(`Google Places ${res.status}: ${text.slice(0, 500)}`);
    }
    await sleep(1000 * attempt * attempt);
  }

  return [];
}

function chooseMatch(
  mosque: MosqueCandidate,
  places: GooglePlace[],
  maxDistanceMeters: number,
  exactDistanceMeters: number,
  ambiguityGapMeters: number,
): { status: string; reason: string; match?: ScoredPlace } {
  const scored = places
    .map((place): ScoredPlace | null => {
      const name = place.displayName?.text?.trim();
      const lat = place.location?.latitude;
      const lng = place.location?.longitude;
      const types = place.types ?? [];
      const isMosque = place.primaryType === 'mosque' || types.includes('mosque');
      if (!name || lat == null || lng == null || !isMosque) return null;
      return {
        place,
        name,
        distanceMeters: distanceMeters(mosque.latitude, mosque.longitude, lat, lng),
      };
    })
    .filter((p): p is ScoredPlace => p !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const best = scored[0];
  if (!best) return { status: 'skipped', reason: 'no_google_mosque_match' };
  if (best.distanceMeters > maxDistanceMeters) {
    return { status: 'skipped', reason: `nearest_match_too_far_${Math.round(best.distanceMeters)}m`, match: best };
  }
  if (isGenericName(best.name)) {
    return { status: 'skipped', reason: 'google_name_is_generic', match: best };
  }

  const second = scored[1];
  if (
    second &&
    best.distanceMeters > exactDistanceMeters &&
    second.distanceMeters - best.distanceMeters < ambiguityGapMeters
  ) {
    return {
      status: 'skipped',
      reason: `ambiguous_second_match_${Math.round(second.distanceMeters)}m_${second.name.slice(0, 60)}`,
      match: best,
    };
  }

  return { status: 'accepted', reason: 'high_confidence_google_places_match', match: best };
}

async function updateMosqueName(mosqueId: string, newName: string): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE mosques
    SET name = ${newName.slice(0, 250)}, updated_at = NOW()
    WHERE id = ${mosqueId}::uuid
      AND deleted_at IS NULL
      AND ${PLACEHOLDER_SQL}
  `;
  return Number(updated) === 1;
}

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is required. Use a server-side key with Places API enabled.');
  }

  const apply = boolArg('apply');
  const limit = intArg('limit', 25);
  const radiusMeters = numberArg('radius', 150);
  const maxDistanceMeters = numberArg('max-distance', Math.min(100, radiusMeters));
  const exactDistanceMeters = numberArg('exact-distance', 20);
  const ambiguityGapMeters = numberArg('ambiguity-gap', 30);
  const maxResultCount = Math.min(intArg('max-results', 10), 20);
  const delayMs = intArg('delay-ms', 300);
  const country = argValue('country');
  const languageCode = argValue('language', 'en');
  const reportPath = argValue(
    'report',
    path.join(process.cwd(), `google-mosque-enrichment-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`),
  ) as string;

  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Limit: ${limit}`);
  console.log(`Radius: ${radiusMeters}m, max distance: ${maxDistanceMeters}m`);
  if (country) console.log(`Country filter: ${country}`);
  console.log();

  const candidates = await fetchCandidates(limit, country);
  console.log(`Loaded ${candidates.length} placeholder mosques.`);

  const rows: ResultRow[] = [];
  let accepted = 0;
  let applied = 0;
  let skipped = 0;
  let errors = 0;

  for (const [idx, mosque] of candidates.entries()) {
    try {
      const places = await searchNearbyMosques(apiKey, mosque, radiusMeters, maxResultCount, languageCode);
      const decision = chooseMatch(
        mosque,
        places,
        maxDistanceMeters,
        exactDistanceMeters,
        ambiguityGapMeters,
      );
      const match = decision.match;
      const shouldApply = apply && decision.status === 'accepted' && match;
      let didApply = false;

      if (decision.status === 'accepted' && match) accepted++;
      else skipped++;

      if (shouldApply) {
        didApply = await updateMosqueName(mosque.id, match.name);
        if (didApply) applied++;
      }

      rows.push({
        mosqueId: mosque.id,
        oldName: mosque.name,
        city: mosque.city ?? '',
        country: mosque.country ?? '',
        latitude: String(mosque.latitude),
        longitude: String(mosque.longitude),
        status: decision.status,
        reason: decision.reason,
        googlePlaceId: match?.place.id ?? '',
        googleName: match?.name ?? '',
        googleAddress: match?.place.formattedAddress ?? '',
        distanceMeters: match ? match.distanceMeters.toFixed(1) : '',
        applied: didApply ? 'yes' : 'no',
      });

      const label = match ? `${match.name} (${match.distanceMeters.toFixed(1)}m)` : 'no match';
      console.log(`${idx + 1}/${candidates.length} ${decision.status}: ${mosque.name} -> ${label}`);
    } catch (err) {
      errors++;
      rows.push({
        mosqueId: mosque.id,
        oldName: mosque.name,
        city: mosque.city ?? '',
        country: mosque.country ?? '',
        latitude: String(mosque.latitude),
        longitude: String(mosque.longitude),
        status: 'error',
        reason: (err as Error).message,
        googlePlaceId: '',
        googleName: '',
        googleAddress: '',
        distanceMeters: '',
        applied: 'no',
      });
      console.error(`${idx + 1}/${candidates.length} error: ${(err as Error).message}`);
    }

    if (delayMs > 0 && idx < candidates.length - 1) await sleep(delayMs);
  }

  await fs.writeFile(reportPath, toCsv(rows), 'utf8');
  console.log();
  console.log(`Accepted: ${accepted}`);
  console.log(`Applied: ${applied}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Report: ${reportPath}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
