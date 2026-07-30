// One-shot e2e: seed users + mosque, drive the suggestion flow through
// the LIVE running server via fetch(), assert each step, clean up.
import { execSync } from 'child_process';

type HttpRes = { status: number; json: () => any };
function http(method: string, url: string, email: string, body?: any): HttpRes {
  const args = [
    '-sS', '-o', '/tmp/_e2e_resp.json',
    '-w', '%{http_code}',
    '-X', method,
    '-H', 'Content-Type: application/json',
    '-H', `X-Dev-User-Email: ${email}`,
  ];
  if (body !== undefined) args.push('-d', JSON.stringify(body));
  args.push(url);
  const status = parseInt(execSync(`curl ${args.map(a => `'${a.replace(/'/g, "'\''")}'`).join(' ')}`, { encoding: 'utf8' }).trim(), 10);
  let parsed: any = {};
  try { parsed = JSON.parse(require('fs').readFileSync('/tmp/_e2e_resp.json', 'utf8')); } catch {}
  return { status, json: () => parsed };
}
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = 'http://localhost:6001';

const log = (...a: any[]) => console.log(...a);
const ok  = (cond: boolean, msg: string) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); log('  ✓', msg); };

async function main() {
  const stamp = Date.now();
  const sug = await prisma.user.create({ data: { email: `e2e-sug-${stamp}@local`, fullName: 'Live Suggester' } });
  const keep = await prisma.user.create({ data: { email: `e2e-keep-${stamp}@local`, fullName: 'Live Keeper' } });
  const m = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
    VALUES ('E2E Suggestion Live', ST_MakePoint(74.30, 31.50)::geography, 31.50, 74.30, 'Lahore', 'Pakistan', NOW(), NOW())
    RETURNING id::text
  `;
  const mosqueId = m[0].id;

  log('seed:');
  log(`  suggester: ${sug.id} (${sug.email})`);
  log(`  keeper:    ${keep.id} (${keep.email})`);
  log(`  mosque:    ${mosqueId}`);

  const headers = (email: string) => ({ 'Content-Type': 'application/json', 'X-Dev-User-Email': email });

  try {
    log('\n=== STEP 1: POST /api/suggestions ===');
    let res = http('POST', `${BASE}/api/suggestions`, sug.email, {
        toUserId: keep.id,
        mosqueId,
        timings: { fajr: '04:50', isha: '20:30' },
        notes: 'new ramadan schedule',
      });
    ok(res.status === 201, `POST /suggestions → 201 (got ${res.status})`);
    const sCreated = (res.json()).suggestion;
    ok(sCreated.status === 'pending', 'created suggestion is pending');
    ok(sCreated.fromUserId === sug.id, 'fromUserId matches authenticated suggester');
    ok(sCreated.toUserId === keep.id, 'toUserId matches the recipient');
    ok(sCreated.timings.fajr === '04:50', 'timings round-tripped');
    const suggestionId: string = sCreated.id;

    log('\n=== STEP 2: GET /api/suggestions/inbox (as keeper) ===');
    res = http('GET', `${BASE}/api/suggestions/inbox`, keep.email);
    ok(res.status === 200, `inbox → 200`);
    const inbox = (res.json()).suggestions;
    const ours = inbox.find((s: any) => s.id === suggestionId);
    ok(!!ours, 'our suggestion appears in keeper inbox');
    ok(ours.fromUser.fullName === 'Live Suggester', 'inbox includes fromUser detail');
    ok(ours.mosque.name === 'E2E Suggestion Live', 'inbox includes mosque detail');
    ok(typeof ours.currentTimings === 'object', 'inbox includes currentTimings for diff');

    log('\n=== STEP 3: suggester is BLOCKED from accepting their own suggestion (403) ===');
    res = http('POST', `${BASE}/api/suggestions/${suggestionId}/accept`, sug.email);
    ok(res.status === 403, `non-recipient accept → 403 (got ${res.status})`);

    log('\n=== STEP 4: keeper accepts ===');
    res = http('POST', `${BASE}/api/suggestions/${suggestionId}/accept`, keep.email);
    ok(res.status === 200, `accept → 200`);
    const accepted = (res.json()).suggestion;
    ok(accepted.status === 'accepted', 'status flipped to accepted');
    ok(!!accepted.respondedAt, 'respondedAt populated');

    log('\n=== STEP 5: DB side-effects ===');
    const subs = await prisma.timingSubmission.findMany({
      where: { mosqueId, submittedById: keep.id }, orderBy: { createdAt: 'desc' },
    });
    ok(subs.length === 1, `keeper has 1 audit-trail TimingSubmission (got ${subs.length})`);
    ok((subs[0].timings as any).fajr === '04:50', 'submission carries the suggested fajr');
    const active = await prisma.prayerSchedule.findFirst({
      where: { mosqueId, isActive: true, deletedAt: null },
    });
    ok(!!active, 'an active PrayerSchedule exists post-accept');
    ok(active!.verificationStatus === 'verified', 'schedule promoted to verified (keeper-affirmed)');
    ok((active!.timings as any).fajr === '04:50', 'active schedule carries new fajr');
    ok((active!.timings as any).isha === '20:30', 'active schedule carries new isha');

    log('\n=== STEP 6: GET /api/mosques/:id reflects the accepted state ===');
    res = http('GET', `${BASE}/api/mosques/${mosqueId}`, sug.email);
    ok(res.status === 200, `GET mosque → 200`);
    const mDetail: any = await res.json();
    log(`    effectiveTimings: ${JSON.stringify(mDetail.effectiveTimings)}`);
    log(`    effectiveKeeper:  ${mDetail.effectiveKeeperName}`);
    ok(mDetail.effectiveTimings?.fajr === '04:50', 'effectiveTimings.fajr matches accepted value');
    ok(mDetail.effectiveKeeperId === keep.id, 'effectiveKeeperId is the keeper who accepted');

    log('\n=== STEP 7: declining a SECOND suggestion does NOT change schedule ===');
    const s2 = await prisma.suggestion.create({
      data: { mosqueId, fromUserId: sug.id, toUserId: keep.id, timings: { fajr: '06:00' } },
    });
    res = http('POST', `${BASE}/api/suggestions/${s2.id}/decline`, keep.email, { note: 'wrong time' });
    ok(res.status === 200, `decline → 200`);
    const declined = (res.json()).suggestion;
    ok(declined.status === 'declined', 'status flipped to declined');
    const subsAfter = await prisma.timingSubmission.count({ where: { mosqueId, submittedById: keep.id } });
    ok(subsAfter === 1, 'no new TimingSubmission created on decline');
    const activeAfter = await prisma.prayerSchedule.findFirst({
      where: { mosqueId, isActive: true, deletedAt: null },
    });
    ok((activeAfter!.timings as any).fajr === '04:50', 'active schedule unchanged by decline');

    log('\n[OK] all 7 steps passed');
  } finally {
    await prisma.timingSubmission.deleteMany({ where: { mosqueId } });
    await prisma.prayerSchedule.deleteMany({ where: { mosqueId } });
    await prisma.suggestion.deleteMany({ where: { mosqueId } });
    await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${mosqueId}`;
    await prisma.user.deleteMany({ where: { id: { in: [sug.id, keep.id] } } });
    await prisma.$disconnect();
    log('\ncleanup done');
  }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
