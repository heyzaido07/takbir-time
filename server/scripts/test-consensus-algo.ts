/**
 * End-to-end test of the consensus + ranking algorithms with realistic
 * data. Creates ONE fresh mosque + 12 contributors with varied
 * reputations / verified flags / submitted timings, casts cross-votes,
 * then prints:
 *
 *   - the per-contributor inputs
 *   - the votes graph
 *   - the resulting keeper ranking (from /api/mosques/:id/keepers)
 *   - the per-prayer consensus (from /api/mosques/:id/consensus)
 *   - the active schedule (what the hero card would show)
 *
 * Run: npx ts-node scripts/test-consensus-algo.ts
 *
 * Cleanup: --clean to delete the test mosque + users afterward.
 *
 * Designed to make the algorithm's behavior visible. Read the printed
 * output and verify the rankings/consensus match expectation.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = process.env.BASE_URL || 'http://localhost:6001';

// 12 contributors with realistic shapes:
//   - 1 long-time verified contributor (Hassan, the imam) — says 05:30
//   - 2 trusted neighbours (Bilal, Omar) with rep 500 — say 05:30
//   - 3 regulars with rep 50 — 2 say 05:30, 1 says 05:35
//   - 4 newcomers with rep 0 — 2 say 05:30, 2 say 05:00 (wrong)
//   - 1 troll with rep 0 — says 03:00 (clearly bogus)
//   - 1 newcomer with rep 0 — only submits Asr, no Fajr
//
// Expected consensus:
//   Fajr — strong support for 05:30 (8 contributors), troll's 03:00 dwarfed
//   Dhuhr / Asr / Isha — Hassan's values dominate
const PEOPLE = [
  { email: 'hassan-imam@test.local',     name: 'Hassan (Imam)',     rep: 5000, verified: true,  fajr: '05:30', dhuhr: '13:30', asr: '17:00', maghrib: null, isha: '20:00', jummah: '13:30' },
  { email: 'bilal-trusted@test.local',   name: 'Bilal',             rep: 500,  verified: false, fajr: '05:30', dhuhr: '13:30', asr: '17:00', maghrib: null, isha: '20:00', jummah: null },
  { email: 'omar-trusted@test.local',    name: 'Omar',              rep: 500,  verified: false, fajr: '05:30', dhuhr: '13:30', asr: '17:00', maghrib: null, isha: '20:00', jummah: null },
  { email: 'aisha-regular@test.local',   name: 'Aisha',             rep: 50,   verified: false, fajr: '05:30', dhuhr: '13:30', asr: '17:00', maghrib: null, isha: '20:00', jummah: null },
  { email: 'fatima-regular@test.local',  name: 'Fatima',            rep: 50,   verified: false, fajr: '05:30', dhuhr: '13:30', asr: '17:00', maghrib: null, isha: '20:00', jummah: null },
  { email: 'yusuf-regular@test.local',   name: 'Yusuf',             rep: 50,   verified: false, fajr: '05:35', dhuhr: '13:30', asr: '17:00', maghrib: null, isha: '20:00', jummah: null },
  { email: 'newcomer1@test.local',       name: 'Newcomer A',        rep: 0,    verified: false, fajr: '05:30', dhuhr: '13:30', asr: '17:00', maghrib: null, isha: '20:00', jummah: null },
  { email: 'newcomer2@test.local',       name: 'Newcomer B',        rep: 0,    verified: false, fajr: '05:30', dhuhr: '13:30', asr: '17:00', maghrib: null, isha: '20:00', jummah: null },
  { email: 'newcomer3@test.local',       name: 'Newcomer C',        rep: 0,    verified: false, fajr: '05:00', dhuhr: '13:00', asr: '16:30', maghrib: null, isha: '19:30', jummah: null },
  { email: 'newcomer4@test.local',       name: 'Newcomer D',        rep: 0,    verified: false, fajr: '05:00', dhuhr: '13:00', asr: '16:30', maghrib: null, isha: '19:30', jummah: null },
  { email: 'troll@test.local',           name: 'Troll',             rep: 0,    verified: false, fajr: '03:00', dhuhr: '11:00', asr: '15:00', maghrib: null, isha: '22:00', jummah: null },
  { email: 'partial-only@test.local',    name: 'Partial submitter', rep: 0,    verified: false, fajr: null,    dhuhr: null,    asr: '17:00', maghrib: null, isha: null,    jummah: null },
];

// Cross-votes — exercise the upvote/downvote paths. Format: voter → target
const VOTES: Array<[string, string, 'upvote' | 'downvote' | 'report']> = [
  // Hassan gets four upvotes (plus naturally his keeperBoost)
  ['bilal-trusted@test.local',  'hassan-imam@test.local', 'upvote'],
  ['omar-trusted@test.local',   'hassan-imam@test.local', 'upvote'],
  ['aisha-regular@test.local',  'hassan-imam@test.local', 'upvote'],
  ['fatima-regular@test.local', 'hassan-imam@test.local', 'upvote'],
  // Bilal also picks up upvotes
  ['aisha-regular@test.local',  'bilal-trusted@test.local', 'upvote'],
  ['newcomer1@test.local',      'bilal-trusted@test.local', 'upvote'],
  // Newcomer-D & C (the disagreeing ones) get downvoted
  ['hassan-imam@test.local',    'newcomer3@test.local', 'downvote'],
  ['bilal-trusted@test.local',  'newcomer4@test.local', 'downvote'],
  // Troll gets downvoted hard
  ['hassan-imam@test.local',    'troll@test.local', 'downvote'],
  ['bilal-trusted@test.local',  'troll@test.local', 'downvote'],
  ['omar-trusted@test.local',   'troll@test.local', 'downvote'],
];

async function api<T = any>(method: string, path: string, body?: any, asEmail?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (asEmail) headers['X-Dev-User-Email'] = asEmail;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data as T;
}

async function main() {
  const cleanup = process.argv.includes('--clean');

  console.log('═══ creating fresh mosque ═══');
  const mosqueName = `Algo-Test ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
  const mosque = await api('POST', '/api/mosques', {
    name: mosqueName, latitude: 33.5, longitude: 73.05,
    city: 'AlgoTest City', country: 'AlgoTest',
  }, PEOPLE[0].email);
  const mosqueId = mosque.id as string;
  console.log(`  mosque: ${mosqueName}\n  id:     ${mosqueId}`);

  console.log('\n═══ creating 12 contributors with reputation/verified flags ═══');
  for (const p of PEOPLE) {
    // Touch /me so the user is auto-created
    await api('GET', '/api/users/me', undefined, p.email);
    // Set reputation + verified directly via Prisma (no admin endpoint)
    await prisma.user.update({
      where: { email: p.email },
      data: {
        reputationPoints: p.rep,
        verifiedContributor: p.verified,
        fullName: p.name,
      },
    });
    console.log(`  ${p.name.padEnd(20)} rep=${String(p.rep).padStart(5)} verified=${p.verified}`);
  }

  console.log('\n═══ each submits their proposed timings ═══');
  const submissionByEmail = new Map<string, string>();
  for (const p of PEOPLE) {
    const timings: any = {};
    if (p.fajr) timings.fajr = p.fajr;
    if (p.dhuhr) timings.dhuhr = p.dhuhr;
    if (p.asr) timings.asr = p.asr;
    if (p.maghrib) timings.maghrib = p.maghrib;
    if (p.isha) timings.isha = p.isha;
    if (p.jummah) timings.jummah = [p.jummah];
    if (Object.keys(timings).length === 0) continue;
    const res = await api('POST', '/api/submissions', { mosqueId, timings }, p.email);
    submissionByEmail.set(p.email, res.submission.id);
    const summary = Object.entries(timings).map(([k, v]) => `${k} ${Array.isArray(v) ? (v as string[]).join('/') : v}`).join('  ');
    console.log(`  ${p.name.padEnd(20)} submitted: ${summary}`);
  }

  console.log('\n═══ casting cross-votes ═══');
  for (const [voterEmail, targetEmail, type] of VOTES) {
    const targetSubId = submissionByEmail.get(targetEmail);
    if (!targetSubId) continue;
    try {
      await api('POST', `/api/submissions/${targetSubId}/vote`, { voteType: type }, voterEmail);
      const voter = PEOPLE.find(p => p.email === voterEmail)!.name;
      const target = PEOPLE.find(p => p.email === targetEmail)!.name;
      console.log(`  ${voter} ${type === 'upvote' ? '▲' : '▼'} ${target}`);
    } catch (e) {
      console.log(`  (vote failed: ${voterEmail} → ${targetEmail}: ${(e as Error).message.slice(0, 80)})`);
    }
  }

  console.log('\n═══ ranked time keepers ═══');
  const k = await api('GET', `/api/mosques/${mosqueId}/keepers`);
  k.keepers.forEach((keeper: any, i: number) => {
    const tag = i === 0 ? '⭐ TOP' : '   ';
    const v = keeper.verifiedContributor ? '✓' : ' ';
    console.log(`  ${tag} ${i + 1}. ${(keeper.submitterName || '').padEnd(20)} ${v}  rating=${(keeper.rating).toFixed(2).padStart(7)}  fajr=${(keeper.timings as any)?.fajr || '—'}`);
  });

  console.log('\n═══ per-prayer consensus ═══');
  const c = await api('GET', `/api/mosques/${mosqueId}/consensus`);
  for (const prayer of ['fajr', 'dhuhr', 'asr', 'isha', 'jummah']) {
    const cc = c.consensus[prayer];
    if (!cc) {
      console.log(`  ${prayer.padEnd(8)} (no consensus)`);
      continue;
    }
    const conf = (cc.confidence * 100).toFixed(0);
    console.log(`  ${prayer.padEnd(8)} time=${cc.time}  confidence=${conf}%  contributors=${cc.contributors}`);
  }

  console.log('\n═══ active schedule (what the hero card uses) ═══');
  const m = await api('GET', `/api/mosques/${mosqueId}`);
  const sched = m.prayerSchedules?.[0];
  if (sched) {
    console.log(`  status:  ${sched.verificationStatus}`);
    console.log(`  timings: ${JSON.stringify(sched.timings)}`);
  } else {
    console.log('  (none)');
  }

  console.log(`\n  mosque url: ${BASE}/api/mosques/${mosqueId}`);

  if (cleanup) {
    console.log('\n═══ cleanup ═══');
    await prisma.timingSubmission.deleteMany({ where: { mosqueId } });
    await prisma.prayerSchedule.deleteMany({ where: { mosqueId } });
    await prisma.userFavorite.deleteMany({ where: { mosqueId } });
    await prisma.mosqueReview.deleteMany({ where: { mosqueId } });
    await prisma.mosque.delete({ where: { id: mosqueId } });
    await prisma.user.deleteMany({ where: { email: { in: PEOPLE.map(p => p.email) } } });
    console.log('  removed test mosque + 12 users');
  } else {
    console.log('\n  Run with --clean to delete this test data afterward.');
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
