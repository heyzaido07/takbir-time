// One-off: load the same env + admin init the API uses, then call
// notifyKeeperUpdate against the live Mujaddiya/Junaid test topic.
// Run from server/: npx ts-node scripts/fire-test-push.ts
import dotenv from 'dotenv';
dotenv.config();

// Importing the auth middleware triggers admin.initializeApp as a side effect.
// We don't actually use the middleware, but it's the existing init path.
import '../src/middleware/auth';
import admin from 'firebase-admin';
import { notifyKeeperUpdate } from '../src/lib/fcm';

(async () => {
  console.log('FCM_ENABLED =', process.env.FCM_ENABLED);
  console.log('FIREBASE_PROJECT_ID =', process.env.FIREBASE_PROJECT_ID);
  console.log('admin.apps.length =', admin.apps.length);
  if (!admin.apps.length) {
    console.error('❌ firebase-admin NOT initialized — check FIREBASE_* env vars');
    process.exit(1);
  }
  console.log('✅ firebase-admin initialized');

  const args = {
    mosqueId:     process.argv[2] || '9e81a260-7f28-4b2a-9e8f-1613e45a85ed',
    submitterId:  process.argv[3] || 'c974fd26-eb98-411d-a5d1-3bcd836d99cd',
    submissionId: `manual-test-${Date.now()}`,
    keeperName:   'junaid.qazi.veemed',
    mosqueName:   'Mujaddiya Masjid',
    timings:      { isha: '20:45' },
    scheduleChanges: [{
      prayer: 'isha', action: 'promoted', reason: 'manual fire-test',
      from: '20:30', to: '20:45',
    }],
  };
  console.log('Firing push for topic: keeper-' + args.submitterId + '-mosque-' + args.mosqueId);

  const result = await notifyKeeperUpdate(args);
  console.log('Result:', JSON.stringify(result, null, 2));
  process.exit(result.sent ? 0 : 2);
})().catch(e => { console.error('script crashed:', e); process.exit(3); });
