/**
 * Wikidata supplement for US mosques.
 *
 * Wikidata's mosque entries are richer than OSM in some cases (well-known
 * named mosques) but much smaller in count (~95 for USA). Import the ones
 * NOT already in our DB, deduped by proximity (any mosque within 100m of
 * the same coords is treated as a duplicate).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SPARQL = `
SELECT ?item ?itemLabel ?coord ?cityLabel WHERE {
  ?item wdt:P31/wdt:P279* wd:Q32815 .
  ?item wdt:P17 wd:Q30 .
  ?item wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P131 ?city }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`.trim();

interface WdHit {
  itemQid: string;
  name: string;
  city: string | null;
  lat: number;
  lng: number;
}

function parseResults(data: any): WdHit[] {
  const out: WdHit[] = [];
  for (const r of data.results.bindings) {
    const url = r.item?.value as string;
    const coord = r.coord?.value as string; // "Point(-87.6248 41.8132)"
    const m = coord?.match(/^Point\(([-\d.]+) ([-\d.]+)\)$/);
    if (!m) continue;
    const lng = parseFloat(m[1]);
    const lat = parseFloat(m[2]);
    if (Number.isNaN(lng) || Number.isNaN(lat)) continue;
    const qid = url?.split('/').pop() || '';
    out.push({
      itemQid: qid,
      name: (r.itemLabel?.value as string) || qid,
      city: (r.cityLabel?.value as string) || null,
      lat,
      lng,
    });
  }
  return out;
}

async function main() {
  console.log('🔍 Querying Wikidata for US mosques…');
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(SPARQL)}&format=json`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'TakbeerTime-Importer/1.0 (sadqa-fe-sabilillah; one-time supplement)',
    },
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  const data = await res.json();
  const hits = parseResults(data);
  console.log(`📦 ${hits.length} US mosque entries from Wikidata`);

  let inserted = 0, skippedDup = 0, skippedErr = 0;

  for (const h of hits) {
    try {
      // Dedupe by location: any existing mosque within 100m is a match.
      const dup = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name
        FROM mosques
        WHERE deleted_at IS NULL
          AND ST_DWithin(
            location,
            ST_MakePoint(${h.lng}, ${h.lat})::geography,
            100
          )
        LIMIT 1
      `;
      if (dup.length > 0) {
        skippedDup++;
        continue;
      }

      await prisma.$executeRaw`
        INSERT INTO mosques (
          name, location, latitude, longitude,
          city, country, created_at, updated_at
        ) VALUES (
          ${h.name.slice(0, 250)},
          ST_MakePoint(${h.lng}, ${h.lat})::geography,
          ${h.lat}, ${h.lng},
          ${(h.city || 'Unknown').slice(0, 100)},
          'United States',
          NOW(), NOW()
        )
      `;
      inserted++;
    } catch (e) {
      skippedErr++;
    }
  }

  console.log(`✅ Done: ${inserted} new, ${skippedDup} already in DB, ${skippedErr} errors`);

  const total = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c FROM mosques WHERE country = 'United States'
  `;
  console.log(`   USA total in DB: ${total[0].c.toString()}`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
