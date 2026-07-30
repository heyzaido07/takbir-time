/**
 * OSM Mosque Importer
 *
 * Pulls every `amenity=place_of_worship + religion=muslim` POI from
 * OpenStreetMap via the Overpass API, country by country, and inserts
 * into the local Postgres + PostGIS database.
 *
 * Usage:
 *   npx ts-node scripts/import-osm.ts --country MA      # single country (ISO 3166-1 alpha-2)
 *   npx ts-node scripts/import-osm.ts --all             # every country in COUNTRIES below
 *   npx ts-node scripts/import-osm.ts --resume          # skip countries already in progress.json
 *
 * Resumable: progress is logged to ./osm-import-progress.json. Dedupes on
 * mosques.osm_id so re-runs are safe.
 *
 * Be polite: 2.5s sleep between countries, generous timeout, single
 * Overpass instance. Don't hammer the public API.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const PROGRESS_FILE = path.join(__dirname, '..', 'osm-import-progress.json');
const POLITE_DELAY_MS = parseInt(process.env.OSM_DELAY_MS || '2500', 10);
const QUERY_TIMEOUT_S = 180;

type ProgressMap = Record<string, { count: number; error?: string; at: string }>;

// ISO 3166-1 alpha-2 country codes — the full UN-recognised set. Roughly
// ordered to front-load Muslim-majority countries (so worldwide imports
// reach high-density data first if interrupted partway).
const COUNTRIES: Array<[string, string]> = [
  // Muslim-majority / dense first
  ['ID', 'Indonesia'], ['PK', 'Pakistan'], ['IN', 'India'], ['BD', 'Bangladesh'],
  ['NG', 'Nigeria'], ['EG', 'Egypt'], ['IR', 'Iran'], ['TR', 'Turkey'],
  ['SA', 'Saudi Arabia'], ['DZ', 'Algeria'], ['IQ', 'Iraq'], ['MA', 'Morocco'],
  ['SD', 'Sudan'], ['AF', 'Afghanistan'], ['ET', 'Ethiopia'], ['UZ', 'Uzbekistan'],
  ['YE', 'Yemen'], ['SY', 'Syria'], ['MY', 'Malaysia'], ['NE', 'Niger'],
  ['SN', 'Senegal'], ['SO', 'Somalia'], ['TD', 'Chad'], ['KZ', 'Kazakhstan'],
  ['GN', 'Guinea'], ['TN', 'Tunisia'], ['ML', 'Mali'], ['CI', 'Côte d\'Ivoire'],
  ['JO', 'Jordan'], ['AZ', 'Azerbaijan'], ['BF', 'Burkina Faso'], ['TJ', 'Tajikistan'],
  ['LY', 'Libya'], ['TM', 'Turkmenistan'], ['KG', 'Kyrgyzstan'], ['LB', 'Lebanon'],
  ['SL', 'Sierra Leone'], ['AE', 'United Arab Emirates'], ['MR', 'Mauritania'],
  ['OM', 'Oman'], ['KW', 'Kuwait'], ['GM', 'Gambia'], ['BH', 'Bahrain'], ['QA', 'Qatar'],
  ['DJ', 'Djibouti'], ['BN', 'Brunei'], ['MV', 'Maldives'], ['KM', 'Comoros'],
  ['PS', 'Palestine'], ['XK', 'Kosovo'], ['AL', 'Albania'],

  // Major non-Muslim-majority with sizable populations
  ['US', 'United States'], ['GB', 'United Kingdom'], ['FR', 'France'], ['DE', 'Germany'],
  ['CN', 'China'], ['RU', 'Russia'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'],
  ['CA', 'Canada'], ['AU', 'Australia'], ['ZA', 'South Africa'], ['BE', 'Belgium'],
  ['SE', 'Sweden'], ['CH', 'Switzerland'], ['AT', 'Austria'], ['NO', 'Norway'],
  ['DK', 'Denmark'], ['IE', 'Ireland'], ['NZ', 'New Zealand'], ['SG', 'Singapore'],
  ['TH', 'Thailand'], ['PH', 'Philippines'], ['VN', 'Vietnam'], ['JP', 'Japan'],
  ['KR', 'South Korea'], ['MX', 'Mexico'], ['BR', 'Brazil'], ['AR', 'Argentina'],

  // Remaining countries (alphabetical, condensed)
  ['AD', 'Andorra'], ['AG', 'Antigua and Barbuda'], ['AM', 'Armenia'], ['AO', 'Angola'],
  ['BB', 'Barbados'], ['BG', 'Bulgaria'], ['BI', 'Burundi'], ['BJ', 'Benin'],
  ['BO', 'Bolivia'], ['BS', 'Bahamas'], ['BT', 'Bhutan'], ['BW', 'Botswana'],
  ['BY', 'Belarus'], ['BZ', 'Belize'], ['CD', 'DR Congo'], ['CF', 'CAR'], ['CG', 'Congo'],
  ['CL', 'Chile'], ['CM', 'Cameroon'], ['CO', 'Colombia'], ['CR', 'Costa Rica'],
  ['CU', 'Cuba'], ['CV', 'Cape Verde'], ['CY', 'Cyprus'], ['CZ', 'Czechia'],
  ['DM', 'Dominica'], ['DO', 'Dominican Republic'], ['EC', 'Ecuador'], ['EE', 'Estonia'],
  ['ER', 'Eritrea'], ['FI', 'Finland'], ['FJ', 'Fiji'], ['FM', 'Micronesia'],
  ['GA', 'Gabon'], ['GD', 'Grenada'], ['GE', 'Georgia'], ['GH', 'Ghana'],
  ['GQ', 'Equatorial Guinea'], ['GR', 'Greece'], ['GT', 'Guatemala'], ['GW', 'Guinea-Bissau'],
  ['GY', 'Guyana'], ['HN', 'Honduras'], ['HR', 'Croatia'], ['HT', 'Haiti'], ['HU', 'Hungary'],
  ['IL', 'Israel'], ['IS', 'Iceland'], ['JM', 'Jamaica'], ['KE', 'Kenya'], ['KH', 'Cambodia'],
  ['KI', 'Kiribati'], ['KN', 'Saint Kitts and Nevis'], ['LA', 'Laos'], ['LC', 'Saint Lucia'],
  ['LI', 'Liechtenstein'], ['LK', 'Sri Lanka'], ['LR', 'Liberia'], ['LS', 'Lesotho'],
  ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['LV', 'Latvia'], ['MC', 'Monaco'],
  ['MD', 'Moldova'], ['ME', 'Montenegro'], ['MG', 'Madagascar'], ['MH', 'Marshall Islands'],
  ['MK', 'North Macedonia'], ['MM', 'Myanmar'], ['MN', 'Mongolia'], ['MT', 'Malta'],
  ['MU', 'Mauritius'], ['MW', 'Malawi'], ['MZ', 'Mozambique'], ['NA', 'Namibia'],
  ['NI', 'Nicaragua'], ['NP', 'Nepal'], ['NR', 'Nauru'], ['PA', 'Panama'], ['PE', 'Peru'],
  ['PG', 'Papua New Guinea'], ['PL', 'Poland'], ['PT', 'Portugal'], ['PW', 'Palau'],
  ['PY', 'Paraguay'], ['RO', 'Romania'], ['RS', 'Serbia'], ['RW', 'Rwanda'],
  ['SB', 'Solomon Islands'], ['SC', 'Seychelles'], ['SI', 'Slovenia'], ['SK', 'Slovakia'],
  ['SM', 'San Marino'], ['SR', 'Suriname'], ['ST', 'São Tomé'], ['SV', 'El Salvador'],
  ['SZ', 'Eswatini'], ['TG', 'Togo'], ['TL', 'Timor-Leste'], ['TO', 'Tonga'],
  ['TT', 'Trinidad and Tobago'], ['TV', 'Tuvalu'], ['TW', 'Taiwan'], ['TZ', 'Tanzania'],
  ['UA', 'Ukraine'], ['UG', 'Uganda'], ['UY', 'Uruguay'], ['VA', 'Vatican City'],
  ['VC', 'Saint Vincent'], ['VE', 'Venezuela'], ['VU', 'Vanuatu'], ['WS', 'Samoa'],
  ['ZM', 'Zambia'], ['ZW', 'Zimbabwe'], ['BA', 'Bosnia and Herzegovina'],
];

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function loadProgress(): Promise<ProgressMap> {
  try {
    const text = await fs.readFile(PROGRESS_FILE, 'utf8');
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function saveProgress(p: ProgressMap) {
  await fs.writeFile(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

async function fetchCountryOnce(iso2: string): Promise<OsmElement[]> {
  // We catch mosques two ways:
  //  1. The standard tag combination: amenity=place_of_worship + religion=muslim
  //  2. ALSO any place_of_worship whose name matches mosque/masjid/islamic-center
  //     (case-insensitive). OSM tagging in the US, UK, and other diaspora
  //     regions is notoriously incomplete — many mosques have a name but
  //     missing religion tag. The osm_id UNIQUE constraint dedupes overlap.
  const query = `
[out:json][timeout:${QUERY_TIMEOUT_S}];
area["ISO3166-1"="${iso2}"]->.country;
(
  node["amenity"="place_of_worship"]["religion"="muslim"](area.country);
  way["amenity"="place_of_worship"]["religion"="muslim"](area.country);
  relation["amenity"="place_of_worship"]["religion"="muslim"](area.country);
  node["amenity"="place_of_worship"]["name"~"[Mm]osque|[Mm]asjid|[Ii]slamic [Cc]enter|[Mm]usalla"](area.country);
  way["amenity"="place_of_worship"]["name"~"[Mm]osque|[Mm]asjid|[Ii]slamic [Cc]enter|[Mm]usalla"](area.country);
  relation["amenity"="place_of_worship"]["name"~"[Mm]osque|[Mm]asjid|[Ii]slamic [Cc]enter|[Mm]usalla"](area.country);
);
out center;
`.trim();

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TakbeerTime-Importer/1.0 (sadqa-fe-sabilillah; one-time bulk import)',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Overpass ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { elements?: OsmElement[] };
  return data.elements ?? [];
}

// Wrap with one retry for transient Overpass failures (429 quota, 504 timeout).
// The first burst of the import hit 429 on ~27 countries; one cool-down retry
// is plenty to pick most of them up without re-engineering the rate limiter.
async function fetchCountry(iso2: string): Promise<OsmElement[]> {
  try {
    return await fetchCountryOnce(iso2);
  } catch (err) {
    const msg = (err as Error).message || '';
    const transient = /Overpass (429|504|502|503)/.test(msg);
    if (!transient) throw err;
    process.stdout.write(`(429/5xx — cooling 60s) `);
    await sleep(60_000);
    return await fetchCountryOnce(iso2);
  }
}

function pickName(tags: Record<string, string> = {}, fallback: string): string {
  return (
    tags.name ||
    tags['name:en'] ||
    tags['name:ar'] ||
    tags['old_name'] ||
    fallback
  ).slice(0, 250);
}

async function importCountry(iso2: string, countryName: string) {
  process.stdout.write(`  ${iso2.padEnd(3)} ${countryName.padEnd(28)} `);
  const t0 = Date.now();

  let elements: OsmElement[];
  try {
    elements = await fetchCountry(iso2);
  } catch (err) {
    console.log(`  ❌ ${(err as Error).message}`);
    return { count: 0, error: (err as Error).message };
  }

  let inserted = 0, skipped = 0;
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) { skipped++; continue; }

    const tags = el.tags ?? {};
    const name = pickName(tags, `Mosque (OSM ${el.type} ${el.id})`);
    const nameAr = tags['name:ar'] ?? null;
    const city = (tags['addr:city'] || tags['is_in:city'] || tags['is_in'] || 'Unknown').slice(0, 100);
    const addr = (tags['addr:street'] || tags['addr:full'] || null)?.slice(0, 250) ?? null;
    const phone = (tags.phone || tags['contact:phone'] || null)?.slice(0, 20) ?? null;
    const email = (tags.email || tags['contact:email'] || null)?.slice(0, 250) ?? null;
    const website = normalizeWebsite(tags.website || tags['contact:website'] || tags.url || null);

    try {
      await prisma.$executeRaw`
        INSERT INTO mosques (
          name, name_arabic, location, latitude, longitude,
          address_line1, city, country, phone_number, email, website,
          osm_id, created_at, updated_at
        ) VALUES (
          ${name}, ${nameAr},
          ST_MakePoint(${lng}, ${lat})::geography,
          ${lat}, ${lng},
          ${addr}, ${city}, ${countryName.slice(0, 100)},
          ${phone}, ${email}, ${website},
          ${el.id}, NOW(), NOW()
        )
        ON CONFLICT (osm_id) DO UPDATE SET
          name = EXCLUDED.name,
          name_arabic = EXCLUDED.name_arabic,
          location = EXCLUDED.location,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          city = EXCLUDED.city,
          country = EXCLUDED.country,
          phone_number = COALESCE(EXCLUDED.phone_number, mosques.phone_number),
          email = COALESCE(EXCLUDED.email, mosques.email),
          website = COALESCE(EXCLUDED.website, mosques.website),
          updated_at = NOW()
      `;
      inserted++;
    } catch (e) {
      skipped++;
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${String(inserted).padStart(6)} mosques  (${dt}s${skipped ? `, ${skipped} skipped` : ''})`);
  return { count: inserted, dt };
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function normalizeWebsite(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return url.slice(0, 500);
}

async function main() {
  const args = process.argv.slice(2);
  const single = args.indexOf('--country') >= 0 ? args[args.indexOf('--country') + 1] : null;
  const all = args.includes('--all');
  const resume = args.includes('--resume');

  if (!single && !all) {
    console.error('Usage: import-osm.ts --country MA  |  --all  |  --all --resume');
    process.exit(2);
  }

  const targets = single
    ? COUNTRIES.filter(([code]) => code === single.toUpperCase())
    : COUNTRIES;

  if (targets.length === 0) {
    console.error(`Unknown country code: ${single}`);
    process.exit(2);
  }

  const progress = await loadProgress();
  console.log(`📥 Importing ${targets.length} countries from OSM Overpass`);
  console.log(`📋 Resume mode: ${resume ? 'on (skipping done countries)' : 'off'}`);
  console.log();

  let totalInserted = 0;
  let countriesDone = 0;

  for (const [iso2, name] of targets) {
    if (resume && progress[iso2] && !progress[iso2].error) {
      console.log(`  ${iso2.padEnd(3)} ${name.padEnd(28)}    skipped (already done: ${progress[iso2].count})`);
      continue;
    }

    const result = await importCountry(iso2, name);
    progress[iso2] = {
      count: result.count,
      error: 'error' in result ? (result as any).error : undefined,
      at: new Date().toISOString(),
    };
    await saveProgress(progress);
    totalInserted += result.count;
    countriesDone++;

    await sleep(POLITE_DELAY_MS);
  }

  console.log();
  console.log(`✅ Done. ${totalInserted} mosques inserted/updated across ${countriesDone} countries.`);
  console.log(`   Progress log: ${PROGRESS_FILE}`);

  const totalRow = await prisma.$queryRaw<Array<{ c: bigint }>>`SELECT COUNT(*)::bigint AS c FROM mosques`;
  console.log(`   Total in DB: ${totalRow[0].c.toString()} rows`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
