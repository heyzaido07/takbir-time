# Programmatic SEO pages

Generates static, crawlable landing pages from the mosque database so Takbeer
Time can rank for long-tail local searches like *"jamaat time <masjid>"* and
*"prayer times <city>"* — the traffic a directory app lives on.

## What it produces

Written into the **web root** (the folder nginx serves — same place as
`index.html`):

| Output | URL | Purpose |
|---|---|---|
| `masjid/<name>-<id6>/index.html` | `/masjid/central-jamia-masjid-ab12cd/` | One page per mosque: daily jamaat/iqamah table, Jummah, FAQ, `Mosque` + `FAQPage` + `BreadcrumbList` JSON-LD |
| `prayer-times/<city>/index.html` | `/prayer-times/lahore/` | One page per city listing every masjid (`ItemList` JSON-LD) |
| `prayer-times/index.html` | `/prayer-times/` | Index of all cities, grouped by country |
| `sitemap-seo-N.xml` | — | Sitemap(s) of all **indexable** pages (chunked at 45k URLs) |
| `sitemap-index.xml` | — | References `sitemap.xml` (core) + the generated sitemaps |
| `seo/seo.css` | `/seo/seo.css` | Shared styling (already committed) |

Clean URLs work because nginx is configured with `try_files $uri $uri/` — a
folder resolves to its `index.html`.

## How to run

From the **`server/`** directory:

```bash
npm run seo:generate:dry     # compute + print a report, write nothing
npm run seo:generate         # actually write the files
```

Requires the same setup as the rest of the server: `DATABASE_URL` set (see
`.env`), and `npx prisma generate` already run.

### Options (env vars)

| Var | Default | Meaning |
|---|---|---|
| `SEO_SITE_ORIGIN` | `https://takbeertime.com` | Canonical origin used in URLs/tags |
| `SEO_OUT_DIR` | repo root | Where to write the HTML/sitemaps |
| `SEO_DRY_RUN=1` / `--dry` | off | Report only, write nothing |

## Quality gates (why this won't get you penalized)

- **No thin content published.** A mosque with no prayer data is rendered
  `noindex` and kept **out of the sitemap**. Only pages with real times are
  advertised to Google.
- **No fabricated data.** FAQ answers and time tables are built strictly from
  values in the DB. Missing prayer → row omitted, not invented.
- **Unique URLs.** Each mosque slug ends in 6 chars of its UUID, so duplicate
  names never collide and URLs stay stable across regenerations.
- **Internal linking.** mosque → city → city-index and back, so crawlers can
  reach every page and link equity flows.

## When to regenerate

Re-run after meaningful data changes (new mosques imported, timings updated).
A weekly cron alongside the existing scraper crons is a good cadence:

```bash
cd server && npm run seo:generate
```

## After the first run

1. Confirm `robots.txt` points at `/sitemap-index.xml` (already updated).
2. In Google Search Console → **Sitemaps**, submit `sitemap-index.xml`.
3. Spot-check a generated page with the
   [Rich Results Test](https://search.google.com/test/rich-results).

## Files

| File | Role |
|---|---|
| `generate-seo-pages.ts` | Main script: query DB → build data → write pages + sitemaps |
| `templates.ts` | HTML templates (mosque / city / city-index) |
| `format.ts` | Pure helpers: slugify, prayer-time normalization, escaping |
