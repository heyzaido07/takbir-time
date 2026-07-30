/**
 * Unified Jummah / prayer-time importer.
 *
 * Pulls local mosques from the DB and, for each one, asks one or more scraper
 * sources for a confident match. Matches are submitted as TimingSubmission +
 * pending PrayerSchedule rows under each source's time keeper.
 *
 * Sources:
 *   mawaqit    mawaqit.net  - Friday + full daily iqamah; submitted as "MayAllahRewardMawaqit.net"
 *   jamaat360  jamaat360.com - Friday time; submitted as "MayAllahRewardJamaat360.com"
 *   fiveprayers fiveprayers.org - Friday + full daily iqamah; submitted as "MayAllahRewardFivePrayers.org"
 *   mosquehq   mosquehq.com - Friday + full daily iqamah; submitted as "MayAllahRewardMosqueHQ.com"
 *   masjidi    api.masjidiapp.com - Friday + iqamah; requires MASJIDI_API_KEY
 *   websites   the masjid's own website - Friday time; submitted as "MayAllahRewardMasjidWebsiteAdmins"
 *   official   official country/city prayer-start timetables: JAKIM, MUIS, Vaktija.ba,
 *              Dubai IACAD, Morocco Habous, Diyanet, Kemenag/Bimas Islam
 *
 * Dry-run (default — no writes):
 *   npx ts-node scripts/import-jummah.ts --source mawaqit --country Pakistan --limit 50
 *
 * Apply:
 *   JUMMAH_SCRAPER_ENABLED=true npx ts-node scripts/import-jummah.ts --source all --global --apply
 *
 * Resume an interrupted run (re-uses the progress file):
 *   JUMMAH_SCRAPER_ENABLED=true npx ts-node scripts/import-jummah.ts --source all --global --apply --resume
 *
 * Weekly refresh of Mawaqit-sourced mosques (used by the cron job):
 *   JUMMAH_SCRAPER_ENABLED=true npx ts-node scripts/import-jummah.ts --source mawaqit --global --apply --refresh
 *
 * Disable all writes later (once there is a critical mass of real users):
 *   JUMMAH_SCRAPER_ENABLED=false
 */

import { PrismaClient } from '@prisma/client';
import {
  CoreArgs,
  LocalMosque,
  Progress,
  ScraperSource,
  DEFAULT_SCRAPER_IDENTITY,
  bumpSkipped,
  getScraperUser,
  loadMosques,
  progressFilePath,
  readProgress,
  runPool,
  writeMatch,
  writeProgress,
} from './lib/jummah-import-core';
import { createMawaqitSource } from './lib/sources/mawaqit';
import { createJamaat360Source } from './lib/sources/jamaat360';
import { createMasjidiSource } from './lib/sources/masjidi';
import { createWebsiteSource } from './lib/sources/website';
import { createFivePrayersSource } from './lib/sources/fiveprayers';
import { createMosqueHqSource } from './lib/sources/mosquehq';
import {
  createDiyanetSource,
  createIacadDubaiSource,
  createJakimESolatSource,
  createKemenagBimasSource,
  createMoroccoHabousSource,
  createMuisSource,
  createVaktijaBaSource,
} from './lib/sources/official-daily';

const DEFAULT_SOURCES = ['mawaqit', 'jamaat360', 'fiveprayers', 'mosquehq', 'websites'] as const;
const OFFICIAL_SOURCES = ['jakim', 'muis', 'vaktija', 'iacad', 'habous', 'diyanet', 'kemenag'] as const;
const VALID_SOURCES = [...DEFAULT_SOURCES, 'masjidi', ...OFFICIAL_SOURCES] as const;
const BATCH_SIZE = 500;
const EXAMPLE_LIMIT = 15;

// Countries where Mawaqit / Jamaat360 / masjid-website coverage is densest.
// A global run processes these first so real matches surface within the first
// hour instead of after grinding alphabetically through low-coverage countries.
const PRIORITY_COUNTRIES = [
  'France', 'Belgium', 'Netherlands', 'Germany', 'United Kingdom', 'Spain',
  'Switzerland', 'Italy', 'Austria', 'Sweden', 'Norway', 'Denmark', 'Ireland', 'Portugal',
  'United States', 'Canada', 'Australia',
  'Pakistan', 'India', 'Bangladesh', 'Malaysia', 'Indonesia',
  'Morocco', 'Algeria', 'Tunisia', 'Egypt', 'Saudi Arabia',
  'United Arab Emirates', 'Turkey', 'South Africa',
];

/** Stable-sorts priority countries to the front, keeping the load order otherwise. */
function prioritizeMosques(mosques: LocalMosque[]): LocalMosque[] {
  const rank = new Map(PRIORITY_COUNTRIES.map((c, i) => [c.toLowerCase(), i]));
  return mosques
    .map((m, i) => ({
      m,
      i,
      r: rank.get(m.country.toLowerCase()) ?? PRIORITY_COUNTRIES.length,
    }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.m);
}

// Proven-yield allow-list: a --global run only scans these countries. Derived
// from observed match rates — every country here cleared ~5%+ in real runs,
// while the rest (Pakistan/India/Bangladesh/Australia/NZ/Greece, the long tail)
// returned ~0% because Mawaqit/Jamaat360/masjid-website coverage doesn't reach
// them. Pass --all-countries to scan the whole world regardless.
const SCRAPE_COUNTRIES = [
  'France', 'Belgium', 'Netherlands', 'Germany', 'United Kingdom', 'Spain',
  'Switzerland', 'Italy', 'Austria', 'Sweden', 'Ireland', 'Portugal',
  'Finland', 'Luxembourg', 'United States', 'Canada',
  'Morocco', 'Algeria', 'Tunisia',
];

const OFFICIAL_SOURCE_COUNTRIES: Record<string, string[]> = {
  jakim: ['Malaysia'],
  muis: ['Singapore'],
  vaktija: ['Bosnia and Herzegovina', 'Serbia', 'Montenegro'],
  iacad: ['United Arab Emirates'],
  habous: ['Morocco'],
  diyanet: ['Turkey'],
  kemenag: ['Indonesia'],
};

function expandSources(value: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (source: string) => {
    if (!seen.has(source)) {
      seen.add(source);
      out.push(source);
    }
  };

  for (const part of value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
    if (part === 'all') DEFAULT_SOURCES.forEach(add);
    else if (part === 'official') OFFICIAL_SOURCES.forEach(add);
    else add(part);
  }
  return out;
}

function globalScrapeCountries(sources: string[], allCountries: boolean): string[] | undefined {
  if (allCountries) return undefined;
  const countries = new Set<string>();
  const officialSet = new Set<string>(OFFICIAL_SOURCES);

  if (sources.some(source => !officialSet.has(source))) {
    SCRAPE_COUNTRIES.forEach(country => countries.add(country));
  }
  for (const source of sources) {
    for (const country of OFFICIAL_SOURCE_COUNTRIES[source] || []) countries.add(country);
  }
  return Array.from(countries);
}

function parseArgs(argv: string[]): CoreArgs {
  let allCountries = false;
  const out: CoreArgs = {
    sources: [],
    apply: false,
    resume: false,
    refresh: false,
    submissionsOnly: false,
    replaceVerified: false,
    includeTestRows: false,
    includePlaceholders: false,
    global: false,
    offset: 0,
    concurrency: 6,
    delayMs: Number(process.env.JUMMAH_SCRAPER_DELAY_MS || 150),
    minScore: 0.78,
    maxDistanceKm: 0.3,
    websiteOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--source') {
      const value = next();
      out.sources = expandSources(value);
    } else if (arg === '--apply') out.apply = true;
    else if (arg === '--resume') out.resume = true;
    else if (arg === '--refresh') out.refresh = true;
    else if (arg === '--submissions-only') out.submissionsOnly = true;
    else if (arg === '--replace-verified') out.replaceVerified = true;
    else if (arg === '--include-test-rows') out.includeTestRows = true;
    else if (arg === '--include-placeholders') out.includePlaceholders = true;
    else if (arg === '--all-countries') allCountries = true;
    else if (arg === '--global') {
      out.global = true;
      out.country = undefined;
    } else if (arg === '--country') {
      out.country = next();
      out.global = false;
    } else if (arg === '--city') out.city = next();
    else if (arg === '--name') out.name = next();
    else if (arg === '--mosque-id') out.mosqueId = next();
    else if (arg === '--limit') out.limit = positiveInt(next(), 'limit');
    else if (arg === '--offset') out.offset = positiveInt(next(), 'offset');
    else if (arg === '--concurrency') out.concurrency = Math.max(1, positiveInt(next(), 'concurrency'));
    else if (arg === '--delay-ms') out.delayMs = Math.max(0, positiveInt(next(), 'delay-ms'));
    else if (arg === '--min-score') out.minScore = Number(next());
    else if (arg === '--max-distance-km') out.maxDistanceKm = Number(next());
    else if (arg === '--help' || arg === '-h') usageAndExit(0);
    else {
      console.error(`Unknown argument: ${arg}`);
      usageAndExit(2);
    }
  }

  if (out.sources.length === 0) {
    console.error('Missing --source (one of: mawaqit, jamaat360, fiveprayers, mosquehq, masjidi, websites, official, all)');
    usageAndExit(2);
  }
  const invalid = out.sources.filter(s => !VALID_SOURCES.includes(s as any));
  if (invalid.length > 0) {
    console.error(`Unknown source(s): ${invalid.join(', ')}`);
    usageAndExit(2);
  }
  if (!out.global && !out.country && !out.city && !out.mosqueId && !out.name) {
    console.error('Specify a scope: --global, --country, --city, --name or --mosque-id');
    usageAndExit(2);
  }
  if (!Number.isFinite(out.minScore) || out.minScore < 0 || out.minScore > 1) {
    throw new Error('--min-score must be between 0 and 1');
  }
  if (!Number.isFinite(out.maxDistanceKm) || out.maxDistanceKm <= 0) {
    throw new Error('--max-distance-km must be positive');
  }
  // The website source only has a surface on mosques that have a saved website.
  out.websiteOnly = out.sources.length === 1 && out.sources[0] === 'websites';
  // A --global run is restricted to the proven-yield allow-list unless --all-countries is passed.
  out.scrapeCountries = out.global ? globalScrapeCountries(out.sources, allCountries) : undefined;
  return out;
}

function positiveInt(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} expects a positive integer`);
  return n;
}

function usageAndExit(code: number): never {
  console.log(`
Usage:
  npx ts-node scripts/import-jummah.ts --source <mawaqit|jamaat360|fiveprayers|mosquehq|masjidi|websites|jakim|muis|vaktija|iacad|habous|diyanet|kemenag|official|all> <scope> [options]

Scope (one required):
  --global                 Active mosques in the proven-yield country allow-list.
  --all-countries          With --global, scan every country (ignore the allow-list).
  --country TEXT           Filter by country.
  --city TEXT              Filter by city.
  --name TEXT              Filter by mosque name.
  --mosque-id UUID         Process a single mosque.

Options:
  --apply                  Write submissions + pending schedules (else dry-run).
  --resume                 Continue from the existing progress file.
  --refresh                Only re-process mosques whose active schedule came
                           from the selected source(s) — used by the weekly cron.
  --limit N / --offset N   Window into the scoped mosque list.
  --concurrency N          Concurrent lookups per source (default 6).
  --delay-ms N             Per-worker delay between mosques (default 150).
  --min-score N            Name+distance match threshold 0..1 (default 0.78).
  --max-distance-km N      Source candidate distance cap (default 0.3).
  --submissions-only       Write TimingSubmission rows only, no PrayerSchedule.
  --replace-verified       Allow overwriting a human-verified active schedule.
  --include-placeholders   Include Jamaat360 pages flagged as needing verification.
  --include-test-rows      Include local E2E/QA fixture mosques.

Notes:
  --source all runs the non-keyed default sources. Use --source masjidi with
  MASJIDI_API_KEY configured for the official Masjidi API.
  --source official runs official daily prayer-start sources. These are not
  mosque-specific iqamah/jamaat times unless the source explicitly says so.
`);
  process.exit(code);
}

function buildSource(name: string, args: CoreArgs): ScraperSource {
  switch (name) {
    case 'mawaqit':
      return createMawaqitSource({ maxDistanceKm: args.maxDistanceKm, minScore: args.minScore });
    case 'jamaat360':
      return createJamaat360Source({
        maxDistanceKm: args.maxDistanceKm,
        minScore: args.minScore,
        includePlaceholders: args.includePlaceholders,
      });
    case 'masjidi':
      return createMasjidiSource({ maxDistanceKm: args.maxDistanceKm, minScore: args.minScore });
    case 'fiveprayers':
      return createFivePrayersSource({ maxDistanceKm: args.maxDistanceKm, minScore: args.minScore });
    case 'mosquehq':
      return createMosqueHqSource({ maxDistanceKm: args.maxDistanceKm, minScore: args.minScore });
    case 'websites':
      return createWebsiteSource();
    case 'jakim':
      return createJakimESolatSource();
    case 'muis':
      return createMuisSource();
    case 'vaktija':
      return createVaktijaBaSource();
    case 'iacad':
      return createIacadDubaiSource();
    case 'habous':
      return createMoroccoHabousSource();
    case 'diyanet':
      return createDiyanetSource();
    case 'kemenag':
      return createKemenagBimasSource();
    default:
      throw new Error(`Unknown source: ${name}`);
  }
}

function scopeLabel(args: CoreArgs): string {
  if (args.global) return 'global';
  return args.country || args.city || args.name || args.mosqueId || 'custom';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.apply && process.env.JUMMAH_SCRAPER_ENABLED !== 'true') {
    throw new Error('Refusing to write: set JUMMAH_SCRAPER_ENABLED=true');
  }

  const prisma = new PrismaClient();
  try {
    const sources = args.sources.map(name => buildSource(name, args));
    const scope = scopeLabel(args);
    const progressFile = progressFilePath(args.sources.join('+'), scope, args.apply);

    const mosques = prioritizeMosques(await loadMosques(prisma, args));

    let progress: Progress = {
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: args.sources.join('+'),
      scope,
      total: mosques.length,
      scanned: 0,
      matched: 0,
      written: 0,
      processedCount: 0,
      skipped: {},
      examples: [],
    };

    let startIndex = 0;
    if (args.resume) {
      const prior = await readProgress(progressFile);
      if (prior && prior.total === mosques.length) {
        progress = { ...prior, total: mosques.length, updatedAt: new Date().toISOString() };
        startIndex = Math.min(prior.processedCount, mosques.length);
        console.log(`Resuming from index ${startIndex} (prior run scanned ${prior.scanned}).`);
      } else {
        console.log('No compatible progress file to resume — starting fresh.');
      }
    }

    console.log(`${args.apply ? 'Applying' : 'Dry-run'} Jummah import`);
    console.log(`Sources: ${args.sources.join(', ')}`);
    console.log(`Scope: ${scope}${args.refresh ? ' (refresh — source-owned schedules only)' : ''}`);
    console.log(`Mosques in scope: ${mosques.length}`);
    console.log(`Match threshold: score >= ${args.minScore}, distance <= ${args.maxDistanceKm} km`);
    console.log(`Concurrency: ${args.concurrency}, delay: ${args.delayMs}ms`);
    console.log(`Progress file: ${progressFile}`);

    // Resolve one DB user per distinct time keeper, up front.
    const userIdByEmail = new Map<string, string>();
    if (args.apply) {
      for (const source of sources) {
        const identity = source.scraperUser ?? DEFAULT_SCRAPER_IDENTITY;
        if (!userIdByEmail.has(identity.email)) {
          const user = await getScraperUser(prisma, identity);
          userIdByEmail.set(identity.email, user.id);
          console.log(`  ${source.name} -> ${user.fullName} <${user.email}> (${user.id})`);
        }
      }
    }

    async function processMosque(mosque: LocalMosque): Promise<void> {
      let anyMatch = false;
      for (const source of sources) {
        const identity = source.scraperUser ?? DEFAULT_SCRAPER_IDENTITY;
        try {
          const match = await source.findMatch(mosque);
          if (!match) continue;
          anyMatch = true;
          progress.matched++;

          if (progress.examples.length < EXAMPLE_LIMIT) {
            progress.examples.push({
              mosqueId: mosque.id,
              mosqueName: mosque.name,
              country: mosque.country,
              source: source.name,
              jummah: match.jummah,
              otherTimings: match.otherTimings,
              score: Number(match.matchScore.toFixed(3)),
              distanceKm: match.distanceKm,
            });
          }

          if (!args.apply) {
            bumpSkipped(progress, 'dry-run');
            continue;
          }
          const userId = userIdByEmail.get(identity.email)!;
          const result = await writeMatch(prisma, mosque, match, userId, identity.fullName, args);
          if (result === 'written') progress.written++;
          else bumpSkipped(progress, result);
        } catch (err) {
          bumpSkipped(progress, `source_error:${source.name}`);
          if (progress.examples.length < EXAMPLE_LIMIT) {
            progress.examples.push({
              mosqueId: mosque.id,
              mosqueName: mosque.name,
              source: source.name,
              error: (err as Error).message,
            });
          }
        }
      }
      progress.scanned++;
      if (!anyMatch) bumpSkipped(progress, 'no_match');
    }

    for (let batchStart = startIndex; batchStart < mosques.length; batchStart += BATCH_SIZE) {
      const batch = mosques.slice(batchStart, batchStart + BATCH_SIZE);
      await runPool(batch, args.concurrency, args.delayMs, processMosque);
      progress.processedCount = batchStart + batch.length;
      await writeProgress(progressFile, progress);
      console.log(
        `Processed ${progress.processedCount}/${mosques.length} — matched ${progress.matched}, written ${progress.written}`,
      );
    }

    await writeProgress(progressFile, progress);
    console.log();
    console.log(
      JSON.stringify(
        {
          source: progress.source,
          scope: progress.scope,
          total: progress.total,
          scanned: progress.scanned,
          matched: progress.matched,
          written: progress.written,
          skipped: progress.skipped,
          examples: progress.examples,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
