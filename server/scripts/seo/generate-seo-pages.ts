/**
 * Static SEO page generator.
 *
 * Reads every active mosque (+ its latest active prayer schedule) from the
 * database and writes fully static HTML pages into the web root that nginx
 * already serves:
 *
 *   /masjid/<name>-<id6>/index.html      → one page per mosque
 *   /prayer-times/<city>/index.html      → one page per city (lists mosques)
 *   /prayer-times/index.html             → index of all cities
 *   /sitemap-seo-N.xml                   → sitemap(s) of the above URLs
 *   /sitemap-index.xml                   → references core + seo sitemaps
 *
 * Because nginx uses `try_files $uri $uri/`, a folder's index.html is served
 * at the clean URL (e.g. /masjid/central-jamia-masjid-ab12cd/).
 *
 * Run:  npm run seo:generate           (from the server/ directory)
 * Env:
 *   SEO_SITE_ORIGIN  canonical origin (default https://takbeertime.com)
 *   SEO_OUT_DIR      web root to write into (default repo root)
 *   SEO_DRY_RUN=1    compute + report, write nothing
 */

import fs from 'fs';
import path from 'path';
import { prisma } from '../../src/lib/prisma';
import { slugify, prayerRows, jummahTimes } from './format';
import { mosquePage, cityPage, cityIndexPage } from './templates';
import type { MosqueData, CityData } from './templates';

const SITE = (process.env.SEO_SITE_ORIGIN || 'https://takbeertime.com').replace(/\/$/, '');
const OUT_DIR = process.env.SEO_OUT_DIR
  ? path.resolve(process.env.SEO_OUT_DIR)
  : path.resolve(__dirname, '../../../'); // → repo/web root
const DRY_RUN = process.env.SEO_DRY_RUN === '1' || process.argv.includes('--dry');
const URLS_PER_SITEMAP = 45000; // under Google's 50k hard limit

function writeFile(relPath: string, contents: string) {
  const full = path.join(OUT_DIR, relPath);
  if (DRY_RUN) return;
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, 'utf8');
}

async function main() {
  console.log(`🔨 Generating SEO pages`);
  console.log(`   origin : ${SITE}`);
  console.log(`   output : ${OUT_DIR}${DRY_RUN ? '  (DRY RUN — nothing written)' : ''}`);

  const mosques = await prisma.mosque.findMany({
    where: { deletedAt: null, status: 'active' },
    select: {
      id: true,
      name: true,
      nameArabic: true,
      city: true,
      stateProvince: true,
      country: true,
      latitude: true,
      longitude: true,
      addressLine1: true,
      website: true,
      updatedAt: true,
      prayerSchedules: {
        where: { isActive: true, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { timings: true, updatedAt: true },
      },
    },
    orderBy: { city: 'asc' },
  });

  console.log(`   loaded : ${mosques.length} active mosques`);
  if (mosques.length === 0) {
    console.warn('⚠  No mosques found. Load real data before generating (the 3 sample rows are fine for a smoke test).');
  }

  // Guarantee unique, stable city slugs even when two countries share a
  // city name (e.g. "Hyderabad"). First slug wins; collisions get the
  // country appended.
  const citySlugByKey = new Map<string, string>();
  const usedCitySlugs = new Set<string>();
  const cityKey = (city: string, country: string) => `${city}||${country}`;
  function resolveCitySlug(city: string, country: string): string {
    const key = cityKey(city, country);
    const existing = citySlugByKey.get(key);
    if (existing) return existing;
    let slug = slugify(city) || 'city';
    if (usedCitySlugs.has(slug)) slug = `${slug}-${slugify(country) || 'x'}`;
    let s = slug;
    let n = 2;
    while (usedCitySlugs.has(s)) s = `${slug}-${n++}`;
    usedCitySlugs.add(s);
    citySlugByKey.set(key, s);
    return s;
  }

  const cities = new Map<string, CityData>();
  const built: MosqueData[] = [];

  for (const m of mosques) {
    const timings = m.prayerSchedules[0]?.timings ?? null;
    const rows = prayerRows(timings);
    const jummah = jummahTimes(timings);
    const indexable = rows.length > 0 || jummah.length > 0;
    const citySlug = resolveCitySlug(m.city, m.country);
    // id6 = short stable suffix → unique URL even for duplicate names.
    const id6 = m.id.replace(/-/g, '').slice(0, 6);
    const slug = `${slugify(m.name) || 'masjid'}-${id6}`;
    const updated = (m.prayerSchedules[0]?.updatedAt ?? m.updatedAt).toISOString();

    const data: MosqueData = {
      id: m.id,
      name: m.name,
      nameArabic: m.nameArabic,
      city: m.city,
      stateProvince: m.stateProvince,
      country: m.country,
      latitude: m.latitude,
      longitude: m.longitude,
      addressLine1: m.addressLine1,
      website: m.website,
      slug,
      citySlug,
      rows,
      jummah,
      updated,
      indexable,
    };
    built.push(data);

    const key = cityKey(m.city, m.country);
    if (!cities.has(key)) {
      cities.set(key, { city: m.city, country: m.country, slug: citySlug, mosques: [], updated });
    }
    cities.get(key)!.mosques.push(data);
  }

  // ── Write mosque pages ────────────────────────────────────────────────
  let indexableCount = 0;
  for (const m of built) {
    writeFile(path.join('masjid', m.slug, 'index.html'), mosquePage(m, SITE));
    if (m.indexable) indexableCount++;
  }

  // ── Write city pages + city index ─────────────────────────────────────
  const cityList = [...cities.values()].sort((a, b) => a.city.localeCompare(b.city));
  for (const c of cityList) {
    c.mosques.sort((a, b) => a.name.localeCompare(b.name));
    writeFile(path.join('prayer-times', c.slug, 'index.html'), cityPage(c, SITE));
  }
  writeFile(path.join('prayer-times', 'index.html'), cityIndexPage(cityList, SITE));

  // ── Sitemaps (only indexable URLs) ────────────────────────────────────
  const urls: { loc: string; lastmod: string; priority: string }[] = [];
  urls.push({ loc: `${SITE}/prayer-times/`, lastmod: today(), priority: '0.8' });
  for (const c of cityList) {
    urls.push({ loc: `${SITE}/prayer-times/${c.slug}/`, lastmod: c.updated.slice(0, 10), priority: '0.7' });
  }
  for (const m of built) {
    if (!m.indexable) continue; // never advertise thin pages
    urls.push({ loc: `${SITE}/masjid/${m.slug}/`, lastmod: m.updated.slice(0, 10), priority: '0.6' });
  }

  const sitemapFiles: string[] = [];
  for (let i = 0; i < urls.length; i += URLS_PER_SITEMAP) {
    const chunk = urls.slice(i, i + URLS_PER_SITEMAP);
    const name = `sitemap-seo-${Math.floor(i / URLS_PER_SITEMAP) + 1}.xml`;
    writeFile(name, sitemapXml(chunk));
    sitemapFiles.push(name);
  }

  // Sitemap index referencing the hand-maintained core sitemap + the
  // generated ones. robots.txt should point at this index.
  writeFile('sitemap-index.xml', sitemapIndexXml(['sitemap.xml', ...sitemapFiles]));

  console.log('\n✅ Done');
  console.log(`   mosque pages     : ${built.length} (${indexableCount} indexable, ${built.length - indexableCount} noindex)`);
  console.log(`   city pages       : ${cityList.length} (+1 city index)`);
  console.log(`   sitemap files    : ${sitemapFiles.length} (${urls.length} URLs) + sitemap-index.xml`);
  if (built.length - indexableCount > 0) {
    console.log(`   ℹ ${built.length - indexableCount} mosque(s) have no timings yet → rendered noindex, kept out of the sitemap.`);
  }
  console.log('\n   Next: point robots.txt at /sitemap-index.xml and submit it in Search Console.');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function sitemapXml(urls: { loc: string; lastmod: string; priority: string }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
}

function sitemapIndexXml(files: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files.map(f => `  <sitemap>
    <loc>${SITE}/${f}</loc>
    <lastmod>${today()}</lastmod>
  </sitemap>`).join('\n')}
</sitemapindex>
`;
}

main()
  .catch(err => {
    console.error('❌ SEO generation failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
