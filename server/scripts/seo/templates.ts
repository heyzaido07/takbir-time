// HTML templates for the generated SEO pages.
//
// Each page is a fully static, self-contained HTML document with:
//   • unique <title> + meta description (built from real mosque/city data)
//   • canonical URL, Open Graph, robots
//   • JSON-LD structured data (Mosque / FAQPage / ItemList / BreadcrumbList)
//   • internal links (mosque → city → index) so crawlers can traverse
//   • a clear call-to-action into the app
//
// Pages with no real prayer data are rendered `noindex` by the generator so
// we never publish thin/duplicate content at scale.

import { escapeHtml, jsonLd } from './format';
import type { PrayerRow } from './format';

export interface MosqueData {
  id: string;
  name: string;
  nameArabic: string | null;
  city: string;
  stateProvince: string | null;
  country: string;
  latitude: number;
  longitude: number;
  addressLine1: string | null;
  website: string | null;
  slug: string;
  citySlug: string;
  rows: PrayerRow[];
  jummah: string[];
  updated: string; // ISO date of the schedule/mosque
  indexable: boolean;
}

export interface CityData {
  city: string;
  country: string;
  slug: string;
  mosques: MosqueData[];
  updated: string;
}

const SHARED_HEAD = (opts: {
  title: string;
  description: string;
  canonical: string;
  indexable: boolean;
  ogImage: string;
}) => `  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0F2A1E" />
  <title>${escapeHtml(opts.title)}</title>
  <meta name="description" content="${escapeHtml(opts.description)}" />
  <meta name="robots" content="${opts.indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow'}" />
  <link rel="canonical" href="${escapeHtml(opts.canonical)}" />
  <link rel="icon" href="/favicon.ico?v=2" sizes="any" />
  <link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png?v=2" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Takbeer Time" />
  <meta property="og:title" content="${escapeHtml(opts.title)}" />
  <meta property="og:description" content="${escapeHtml(opts.description)}" />
  <meta property="og:url" content="${escapeHtml(opts.canonical)}" />
  <meta property="og:image" content="${escapeHtml(opts.ogImage)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(opts.title)}" />
  <meta name="twitter:description" content="${escapeHtml(opts.description)}" />
  <link rel="stylesheet" href="/seo/seo.css?v=1" />`;

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.takbeertime.android';
const APP_CTA = `  <aside class="seo-cta">
    <p><strong>Get live jamaat updates on your phone.</strong> Timekeepers keep these
    times accurate — follow this masjid in the Takbeer Time app to get a reminder
    before every jamaat.</p>
    <a class="seo-btn" href="${PLAY_URL}" rel="nofollow">Open in Takbeer Time</a>
  </aside>`;

function breadcrumbLd(site: string, crumbs: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: site + c.url,
    })),
  };
}

// ── Per-mosque page ─────────────────────────────────────────────────────
export function mosquePage(m: MosqueData, site: string): string {
  const region = [m.city, m.stateProvince, m.country].filter(Boolean).join(', ');
  const canonical = `${site}/masjid/${m.slug}/`;
  const ogImage = `${site}/assets/brand/takbeer-time-icon-512.png`;

  const firstFew = m.rows.slice(0, 3).map(r => `${r.label} ${r.time}`).join(', ');
  const title = `${m.name} — Jamaat & Iqamah Times (${m.city}) | Takbeer Time`;
  const description = m.indexable
    ? `Prayer jamaat and iqamah times at ${m.name}, ${region}. ${firstFew}${m.jummah.length ? `, Jummah ${m.jummah.join(' & ')}` : ''}. Community-verified, updated by local timekeepers.`
    : `${m.name} in ${region}. Help the community by adding verified jamaat and iqamah times for this masjid in the Takbeer Time app.`;

  const timeTable = m.rows.length
    ? `    <table class="seo-times">
      <caption>Daily jamaat &amp; iqamah times</caption>
      <tbody>
${m.rows.map(r => `        <tr><th scope="row">${escapeHtml(r.label)}</th><td>${escapeHtml(r.time)}</td></tr>`).join('\n')}
${m.jummah.length ? `        <tr><th scope="row">Jummah</th><td>${escapeHtml(m.jummah.join(' & '))}</td></tr>` : ''}
      </tbody>
    </table>`
    : `    <p class="seo-empty">No verified jamaat times yet for ${escapeHtml(m.name)}.
    If you pray here, you can add them in the app — it takes a minute and helps
    every traveller who comes after you.</p>`;

  // Truthful FAQ built only from data we actually have — good for rich
  // results and never fabricates a time.
  const faqEntries: { q: string; a: string }[] = [];
  const fajr = m.rows.find(r => r.key === 'fajr');
  const isha = m.rows.find(r => r.key === 'isha');
  if (fajr) faqEntries.push({ q: `What time is Fajr jamaat at ${m.name}?`, a: `Fajr jamaat at ${m.name} (${region}) is at ${fajr.time}.` });
  if (isha) faqEntries.push({ q: `What time is Isha jamaat at ${m.name}?`, a: `Isha jamaat at ${m.name} (${region}) is at ${isha.time}.` });
  if (m.jummah.length) faqEntries.push({ q: `What time is Jummah at ${m.name}?`, a: `Jummah (Friday) prayer at ${m.name} is at ${m.jummah.join(' and ')}.` });

  const graph: unknown[] = [
    breadcrumbLd(site, [
      { name: 'Home', url: '/' },
      { name: `Prayer times in ${m.city}`, url: `/prayer-times/${m.citySlug}/` },
      { name: m.name, url: `/masjid/${m.slug}/` },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'Mosque',
      name: m.name,
      ...(m.nameArabic ? { alternateName: m.nameArabic } : {}),
      url: canonical,
      ...(m.website ? { sameAs: [m.website] } : {}),
      address: {
        '@type': 'PostalAddress',
        ...(m.addressLine1 ? { streetAddress: m.addressLine1 } : {}),
        addressLocality: m.city,
        ...(m.stateProvince ? { addressRegion: m.stateProvince } : {}),
        addressCountry: m.country,
      },
      geo: { '@type': 'GeoCoordinates', latitude: m.latitude, longitude: m.longitude },
    },
  ];
  if (faqEntries.length) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqEntries.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }

  return `<!doctype html>
<html lang="en">
<head>
${SHARED_HEAD({ title, description, canonical, indexable: m.indexable, ogImage })}
  <script type="application/ld+json">
${jsonLd(graph)}
  </script>
</head>
<body>
  <nav class="seo-breadcrumb" aria-label="Breadcrumb">
    <a href="/">Home</a> ›
    <a href="/prayer-times/${escapeHtml(m.citySlug)}/">${escapeHtml(m.city)}</a> ›
    <span aria-current="page">${escapeHtml(m.name)}</span>
  </nav>
  <main class="seo-main">
    <header>
      <h1>${escapeHtml(m.name)} — Jamaat &amp; Iqamah Times</h1>
      ${m.nameArabic ? `<p class="seo-arabic" dir="rtl" lang="ar">${escapeHtml(m.nameArabic)}</p>` : ''}
      <p class="seo-region">${escapeHtml(region)}</p>
    </header>
${timeTable}
${faqEntries.length ? `    <section class="seo-faq">
      <h2>Frequently asked questions</h2>
${faqEntries.map(f => `      <h3>${escapeHtml(f.q)}</h3>\n      <p>${escapeHtml(f.a)}</p>`).join('\n')}
    </section>` : ''}
    <p class="seo-updated">Last updated: ${escapeHtml(m.updated.slice(0, 10))}</p>
${APP_CTA}
    <p class="seo-more">See all masjids in
      <a href="/prayer-times/${escapeHtml(m.citySlug)}/">${escapeHtml(m.city)}</a>.</p>
  </main>
</body>
</html>
`;
}

// ── Per-city page (lists every masjid in the city) ──────────────────────
export function cityPage(c: CityData, site: string): string {
  const canonical = `${site}/prayer-times/${c.slug}/`;
  const ogImage = `${site}/assets/brand/takbeer-time-icon-512.png`;
  const title = `Prayer Times in ${c.city}, ${c.country} — Masjid Jamaat & Iqamah | Takbeer Time`;
  const description = `Jamaat and iqamah times for ${c.mosques.length} masjid${c.mosques.length === 1 ? '' : 's'} in ${c.city}, ${c.country}. Find Fajr, Dhuhr, Asr, Maghrib, Isha and Jummah times near you, verified by local timekeepers.`;

  const list = c.mosques.map((m, i) => {
    const preview = m.rows.slice(0, 2).map(r => `${r.label} ${r.time}`).join(' · ');
    return `      <li>
        <a href="/masjid/${escapeHtml(m.slug)}/">${escapeHtml(m.name)}</a>
        ${m.addressLine1 ? `<span class="seo-addr">${escapeHtml(m.addressLine1)}</span>` : ''}
        ${preview ? `<span class="seo-preview">${escapeHtml(preview)}</span>` : ''}
      </li>`;
  }).join('\n');

  const graph: unknown[] = [
    breadcrumbLd(site, [
      { name: 'Home', url: '/' },
      { name: 'Prayer times', url: '/prayer-times/' },
      { name: c.city, url: `/prayer-times/${c.slug}/` },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `Masjids in ${c.city}, ${c.country}`,
      numberOfItems: c.mosques.length,
      itemListElement: c.mosques.map((m, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${site}/masjid/${m.slug}/`,
        name: m.name,
      })),
    },
  ];

  return `<!doctype html>
<html lang="en">
<head>
${SHARED_HEAD({ title, description, canonical, indexable: true, ogImage })}
  <script type="application/ld+json">
${jsonLd(graph)}
  </script>
</head>
<body>
  <nav class="seo-breadcrumb" aria-label="Breadcrumb">
    <a href="/">Home</a> ›
    <a href="/prayer-times/">Prayer times</a> ›
    <span aria-current="page">${escapeHtml(c.city)}</span>
  </nav>
  <main class="seo-main">
    <header>
      <h1>Prayer Times in ${escapeHtml(c.city)}, ${escapeHtml(c.country)}</h1>
      <p class="seo-region">${c.mosques.length} masjid${c.mosques.length === 1 ? '' : 's'} with community-verified jamaat &amp; iqamah times.</p>
    </header>
    <ul class="seo-list">
${list}
    </ul>
${APP_CTA}
  </main>
</body>
</html>
`;
}

// ── Top-level index of all cities ───────────────────────────────────────
export function cityIndexPage(cities: CityData[], site: string): string {
  const canonical = `${site}/prayer-times/`;
  const ogImage = `${site}/assets/brand/takbeer-time-icon-512.png`;
  const title = 'Masjid Prayer Times by City — Jamaat & Iqamah | Takbeer Time';
  const description = `Browse community-verified masjid jamaat and iqamah times across ${cities.length} cities. Find prayer times near you for Fajr, Jummah, Isha and more.`;

  // Group cities by country for a scannable, well-linked index.
  const byCountry = new Map<string, CityData[]>();
  for (const c of cities) {
    const arr = byCountry.get(c.country) ?? [];
    arr.push(c);
    byCountry.set(c.country, arr);
  }
  const sections = [...byCountry.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([country, list]) => `      <section>
        <h2>${escapeHtml(country)}</h2>
        <ul class="seo-list">
${list.sort((a, b) => a.city.localeCompare(b.city)).map(c => `          <li><a href="/prayer-times/${escapeHtml(c.slug)}/">${escapeHtml(c.city)}</a> <span class="seo-count">(${c.mosques.length})</span></li>`).join('\n')}
        </ul>
      </section>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
${SHARED_HEAD({ title, description, canonical, indexable: true, ogImage })}
</head>
<body>
  <nav class="seo-breadcrumb" aria-label="Breadcrumb">
    <a href="/">Home</a> › <span aria-current="page">Prayer times</span>
  </nav>
  <main class="seo-main">
    <header>
      <h1>Masjid Prayer Times by City</h1>
      <p class="seo-region">Community-verified jamaat &amp; iqamah times across ${cities.length} cities.</p>
    </header>
${sections}
${APP_CTA}
  </main>
</body>
</html>
`;
}
