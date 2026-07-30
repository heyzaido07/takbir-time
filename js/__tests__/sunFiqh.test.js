const sun = require('../sun');

describe('sun-position fiqh presets', () => {
  const islamabad = { lat: 33.6844, lng: 73.0479 };
  const date = new Date('2026-05-03T12:00:00+05:00');
  const minutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  it('uses a later Hanafi Asr than Shafi-style presets', () => {
    const hanafi = sun.prayerTimesForCoords(islamabad.lat, islamabad.lng, 'hanafi', date);
    const shafi = sun.prayerTimesForCoords(islamabad.lat, islamabad.lng, 'shafi', date);

    expect(hanafi.asr).not.toBe(shafi.asr);
    expect(minutes(hanafi.asr)).toBeGreaterThan(minutes(shafi.asr));
  });

  it('changes Fajr/Isha for angle-based methods', () => {
    const hanafi = sun.prayerTimesForCoords(islamabad.lat, islamabad.lng, 'hanafi', date);
    const isna = sun.prayerTimesForCoords(islamabad.lat, islamabad.lng, 'isna', date);

    expect(isna.fajr).not.toBe(hanafi.fajr);
    expect(isna.isha).not.toBe(hanafi.isha);
  });
});
