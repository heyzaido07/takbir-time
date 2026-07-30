const fs = require('fs');
const path = require('path');

function loadStorage() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'state.js'), 'utf8');
  // eslint-disable-next-line no-eval
  window.eval(`${src}\nwindow.__takbeerStorage = storage;`);
  return window.__takbeerStorage;
}

describe('Qaza local storage ownership', () => {
  let storage;

  beforeEach(() => {
    localStorage.clear();
    storage = loadStorage();
  });

  afterEach(() => {
    localStorage.clear();
    delete window.__takbeerStorage;
  });

  it('keeps Qaza records separate per signed-in email', () => {
    const userOneRows = [{ id: 'q1', date: '2026-05-26', prayer: 'fajr' }];
    const userTwoRows = [{ id: 'q2', date: '2026-05-26', prayer: 'isha' }];

    storage.saveQazaRecords(userOneRows, 'one@example.com');
    storage.saveQazaRecords(userTwoRows, 'two@example.com');

    expect(storage.getQazaRecords('one@example.com')).toEqual(userOneRows);
    expect(storage.getQazaRecords('two@example.com')).toEqual(userTwoRows);
  });

  it('does not expose legacy unscoped rows to signed-in users', () => {
    localStorage.setItem('jamat_qaza_records_v1', JSON.stringify([
      { id: 'legacy', date: '2026-05-26', prayer: 'asr' },
    ]));

    expect(storage.getQazaRecords('new@example.com')).toEqual([]);
  });
});

describe('Qaza guest → account migration on sign-in', () => {
  let qaza;
  let storage;

  function loadAppQaza() {
    // app.js references the global `storage` from state.js and exposes the
    // migration helpers via window.__takbeerQazaTest. Eval state.js first
    // (publishing `storage` onto window so app.js's non-strict free
    // reference resolves), then app.js. app.js only boots on
    // DOMContentLoaded, which has already fired in jsdom — so eval just
    // defines the closure without running the app.
    const stateSrc = fs.readFileSync(path.join(__dirname, '..', 'state.js'), 'utf8');
    const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    // eslint-disable-next-line no-eval
    window.eval(`${stateSrc}\nwindow.__takbeerStorage = storage;\nwindow.storage = storage;`);
    // eslint-disable-next-line no-eval
    window.eval(appSrc);
    return { qaza: window.__takbeerQazaTest, storage: window.__takbeerStorage };
  }

  beforeEach(() => {
    localStorage.clear();
    ({ qaza, storage } = loadAppQaza());
  });

  afterEach(() => {
    localStorage.clear();
    delete window.__takbeerQazaTest;
    delete window.__takbeerStorage;
    delete window.storage;
  });

  it('moves anonymous guest rows into the signed-in owner key and clears anonymous', () => {
    storage.saveQazaRecords([
      { id: 'g1', clientId: 'g1', date: '2026-06-01', prayer: 'fajr', prayedAt: null },
      { id: 'g2', clientId: 'g2', date: '2026-06-01', prayer: 'isha', prayedAt: null },
    ], 'anonymous');

    qaza.setEmail('user@example.com'); // jsdom hostname=localhost → dev-auth, so getEmail() returns it
    expect(qaza.qazaOwnerKey()).toBe('user@example.com');

    const migrated = qaza.migrateAnonymousQazaToOwner();
    expect(migrated).toBe(true);

    const owned = storage.getQazaRecords('user@example.com');
    expect(owned.map(r => `${r.date}:${r.prayer}`).sort())
      .toEqual(['2026-06-01:fajr', '2026-06-01:isha']);
    // Anonymous bucket emptied so the rows don't linger or re-migrate.
    expect(storage.getQazaRecords('anonymous')).toEqual([]);
  });

  it('does not duplicate an open row that already exists on the account', () => {
    storage.saveQazaRecords([
      { id: 'srv1', clientId: 'srv1', date: '2026-06-01', prayer: 'fajr', prayedAt: null },
    ], 'user@example.com');
    storage.saveQazaRecords([
      // same date+prayer, different id — must NOT create a second open row
      { id: 'g1', clientId: 'g1', date: '2026-06-01', prayer: 'fajr', prayedAt: null },
      // genuinely new one — must be kept
      { id: 'g2', clientId: 'g2', date: '2026-06-02', prayer: 'asr', prayedAt: null },
    ], 'anonymous');

    qaza.setEmail('user@example.com');
    qaza.migrateAnonymousQazaToOwner();

    const owned = storage.getQazaRecords('user@example.com');
    const openFajrOnJun1 = owned.filter(r => r.date === '2026-06-01' && r.prayer === 'fajr' && !r.prayedAt);
    expect(openFajrOnJun1).toHaveLength(1);
    expect(owned.map(r => `${r.date}:${r.prayer}`).sort())
      .toEqual(['2026-06-01:fajr', '2026-06-02:asr']);
  });

  it('is a no-op for a guest (no email) and when there are no anonymous rows', () => {
    storage.saveQazaRecords([{ id: 'g1', clientId: 'g1', date: '2026-06-01', prayer: 'fajr' }], 'anonymous');
    // No email set → owner is 'anonymous' → must not touch anything.
    expect(qaza.qazaOwnerKey()).toBe('anonymous');
    expect(qaza.migrateAnonymousQazaToOwner()).toBe(false);
    expect(storage.getQazaRecords('anonymous')).toHaveLength(1);

    // Signed in but nothing to migrate.
    storage.saveQazaRecords([], 'anonymous');
    qaza.setEmail('user@example.com');
    expect(qaza.migrateAnonymousQazaToOwner()).toBe(false);
  });
});
