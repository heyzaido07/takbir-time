/**
 * Regression tests for computeNextPrayer in js/components.js.
 *
 * The bug surfaced on 2026-04-29: after Asr passed, the hero card was
 * showing "Asr at 5:15 pm — 23 hours away" instead of advancing to
 * Maghrib. Root cause was in startCountdown (it captured a single `next`
 * at start and never re-resolved). computeNextPrayer itself was correct
 * — these tests lock that in so a future refactor of the picker doesn't
 * silently re-introduce the same class of bug.
 */

const path = require('path');
const fs = require('fs');

function loadRender() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'components.js'), 'utf8');
  // components.js declares `el`, `renderCard`, etc. and at the end does
  // `window.JAMAT_RENDER = { ... }`. We only need computeNextPrayer +
  // PRAYER_ORDER from it. Stub out el() / DOM helpers used by other
  // exports — eval'ing the file under jsdom does the rest.
  // eslint-disable-next-line no-eval
  window.eval(src);
  return window.JAMAT_RENDER;
}

function setNow(hours, minutes, date = null) {
  // jsdom's Date is the real Date. We mock it to a fixed wall-clock time
  // (today's date with the given HH:MM) so `now.getHours()/getMinutes()`
  // returns deterministic values. Restored in afterEach via clearAllMocks
  // — Jest auto-resets useFakeTimers between tests when configured.
  const fixed = date ? new Date(date) : new Date();
  fixed.setHours(hours, minutes, 0, 0);
  jest.useFakeTimers().setSystemTime(fixed);
}

describe('computeNextPrayer', () => {
  let R;

  beforeEach(() => {
    R = loadRender();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete window.JAMAT_RENDER;
    delete window.sun;
  });

  // Pakistan/Mujaddiya-shaped schedule used by most of the assertions.
  const TIMINGS = {
    fajr:    '04:50',
    zuhr:    '13:30', // computeNextPrayer reads this for key='dhuhr'
    asr:     '17:16',
    maghrib: '18:36', // populated by timingsFromMosque from sunset+offset
    isha:    '19:36',
    jummah:  '13:30',
  };

  it('returns Fajr when current time is before Fajr', () => {
    setNow(3, 0);
    const next = R.computeNextPrayer(TIMINGS);
    expect(next.key).toBe('fajr');
    expect(next.time).toBe('04:50');
    expect(next.minutesUntil).toBe(110);
  });

  it('returns Dhuhr after Fajr but before Dhuhr', () => {
    setNow(10, 0, '2026-05-28T00:00:00'); // Thursday
    const next = R.computeNextPrayer(TIMINGS);
    expect(next.key).toBe('dhuhr');
    expect(next.time).toBe('13:30');
  });

  it('uses Jummah instead of Dhuhr on Friday when Jummah exists', () => {
    setNow(10, 0, '2026-05-29T00:00:00'); // Friday
    const next = R.computeNextPrayer(TIMINGS);
    expect(next.key).toBe('jummah');
    expect(next.time).toBe('13:30');
  });

  it('does not treat Jummah as a daily prayer on non-Fridays', () => {
    setNow(10, 0, '2026-05-28T00:00:00'); // Thursday
    const jummahOnly = { jummah: '13:30' };
    const next = R.computeNextPrayer(jummahOnly);
    expect(next.key).toBe('jummah');
    expect(next.minutesUntil).toBe(24 * 60 + 210);
  });

  it('does not let a Jummah-only mosque invent Maghrib from coordinates', () => {
    window.sun = {
      maghribForMosque: jest.fn(() => '18:36'),
    };
    const timings = R.timingsFromMosque({
      coordinates: { lat: 31.5204, lng: 74.3587 },
      defaultJamaatTimings: { jummah: '13:30', maghribOffset: 3 },
    });
    expect(timings.maghrib).toBeUndefined();
    expect(timings.jummah).toBe('13:30');
    expect(window.sun.maghribForMosque).not.toHaveBeenCalled();
    delete window.sun;
  });

  it('renders Jummah instead of Dhuhr in the timings table on Friday', () => {
    setNow(10, 0, '2026-05-29T00:00:00'); // Friday
    const rows = R.renderTimingsTable(TIMINGS).map(row => row.textContent);
    expect(rows.join(' ')).toContain('Jummah');
    expect(rows.join(' ')).not.toContain('Dhuhr');
  });

  it('keeps Jummah visible as a separate traveller row on non-Fridays', () => {
    setNow(10, 0, '2026-05-28T00:00:00'); // Thursday
    const rows = R.renderTimingsTable(TIMINGS).map(row => row.textContent);
    expect(rows.join(' ')).toContain('Dhuhr');
    expect(rows.join(' ')).toContain('Jummah');
  });

  it('returns Asr just before Asr time', () => {
    setNow(17, 0); // 17:00 — Asr at 17:16
    const next = R.computeNextPrayer(TIMINGS);
    expect(next.key).toBe('asr');
    expect(next.minutesUntil).toBe(16);
  });

  it('normalizes 12-hour-looking post-noon jamat rows before picking next prayer', () => {
    setNow(13, 30);
    const aliMurtazaShape = {
      fajr: '04:30',
      zuhr: '01:30',
      asr: '05:30',
      maghrib: '19:08',
      isha: '09:00',
      jummah: '01:30',
    };

    expect(R.normalizePrayerTime('dhuhr', aliMurtazaShape.zuhr)).toBe('13:30');
    expect(R.normalizePrayerTime('asr', aliMurtazaShape.asr)).toBe('17:30');
    expect(R.normalizePrayerTime('isha', aliMurtazaShape.isha)).toBe('21:00');

    const next = R.computeNextPrayer(aliMurtazaShape);
    expect(next.key).toBe('asr');
    expect(next.time).toBe('17:30');
    expect(next.minutesUntil).toBe(240);
  });

  // The regression case from the bug report. Exact moment + expectation.
  it('returns Maghrib (NOT next-day Asr) when Asr just passed', () => {
    setNow(17, 50); // 17:50 — Asr 17:16 has passed; Maghrib at 18:36
    const next = R.computeNextPrayer(TIMINGS);
    expect(next.key).toBe('maghrib');
    expect(next.time).toBe('18:36');
    expect(next.minutesUntil).toBe(46);
  });

  it('returns Isha after Maghrib passes', () => {
    setNow(18, 50); // Maghrib at 18:36 has passed
    const next = R.computeNextPrayer(TIMINGS);
    expect(next.key).toBe('isha');
    expect(next.time).toBe('19:36');
  });

  it('rolls to next-day Fajr after Isha passes', () => {
    setNow(20, 0); // all today's prayers passed
    const next = R.computeNextPrayer(TIMINGS);
    expect(next.key).toBe('fajr');
    // 24*60 - 20*60 + 4*60+50 = 24*60 - 1200 + 290 = 530
    expect(next.minutesUntil).toBe(530);
  });

  // Defensive: the cache could land in a partial state. Make sure we
  // pick whatever's in the schedule rather than crashing or skipping.
  it('handles a schedule missing maghrib gracefully (post-Asr → Isha)', () => {
    setNow(17, 50);
    const partial = { fajr: '04:50', zuhr: '13:30', asr: '17:16', isha: '19:36' };
    const next = R.computeNextPrayer(partial);
    expect(next.key).toBe('isha');
    expect(next.minutesUntil).toBe(106);
  });

  it('returns null when timings is null/empty', () => {
    expect(R.computeNextPrayer(null)).toBeNull();
    expect(R.computeNextPrayer({})).toBeNull();
  });

  it('skips invalid time strings', () => {
    setNow(17, 50);
    const messy = { fajr: '04:50', zuhr: 'not-a-time', asr: '17:16', maghrib: '18:36' };
    const next = R.computeNextPrayer(messy);
    expect(next.key).toBe('maghrib'); // zuhr ignored, picker advances
  });
});

describe('normalizeSubmittedPrayerTime', () => {
  let R;

  beforeEach(() => {
    R = loadRender();
  });

  afterEach(() => {
    delete window.JAMAT_RENDER;
  });

  it('keeps Fajr values in the AM range', () => {
    expect(R.normalizeSubmittedPrayerTime('fajr', '05:30')).toBe('05:30');
  });

  it('defaults non-Fajr submitted prayer times to PM', () => {
    expect(R.normalizeSubmittedPrayerTime('dhuhr', '01:30')).toBe('13:30');
    expect(R.normalizeSubmittedPrayerTime('asr', '05:15')).toBe('17:15');
    expect(R.normalizeSubmittedPrayerTime('isha', '09:00')).toBe('21:00');
    expect(R.normalizeSubmittedPrayerTime('jummah', '00:45')).toBe('12:45');
  });

  it('leaves existing 24-hour PM values unchanged', () => {
    expect(R.normalizeSubmittedPrayerTime('isha', '20:15')).toBe('20:15');
  });

  it('uses prayer-name defaults for empty native time pickers', () => {
    expect(R.defaultSubmittedPrayerTime('fajr')).toBe('05:00');
    expect(R.defaultSubmittedPrayerTime('dhuhr')).toBe('13:00');
    expect(R.defaultSubmittedPrayerTime('asr')).toBe('17:00');
    expect(R.defaultSubmittedPrayerTime('isha')).toBe('20:00');
    expect(R.defaultSubmittedPrayerTime('jummah')).toBe('13:00');
  });
});
