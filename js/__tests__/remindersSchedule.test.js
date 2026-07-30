const path = require('path');
const fs = require('fs');

function loadReminders() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'reminders.js'), 'utf8');
  window.eval(src);
  return window.reminders;
}

describe('reminders schedule', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.reminders;
    window.api = { putMyReminderPrefs: jest.fn(() => Promise.resolve()) };
    window.nativeReminders = {
      schedule: jest.fn(() => Promise.resolve()),
      cancelAll: jest.fn(() => Promise.resolve()),
      ensurePermission: jest.fn(() => Promise.resolve(true)),
    };
    jest.useFakeTimers().setSystemTime(new Date('2026-05-20T21:30:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
    delete window.reminders;
    delete window.api;
    delete window.nativeReminders;
  });

  it('queues future reminders beyond the current day when today has passed', () => {
    const reminders = loadReminders();
    reminders.savePrefs({
      enabled: true,
      perPrayer: { fajr: 10, dhuhr: null, asr: null, maghrib: null, isha: null, jummah: null },
      prayerEnabled: { fajr: true, dhuhr: false, asr: false, maghrib: false, isha: false, jummah: false },
    });

    const scheduled = reminders.schedule({
      fajr: '04:50',
      zuhr: '13:30',
      asr: '17:15',
      maghrib: '19:08',
      isha: '20:30',
      jummah: '13:30',
    }, 'Mujaddiya Masjid');

    expect(scheduled.length).toBe(7);
    expect(scheduled[0].prayer).toBe('fajr');
    expect(scheduled[0].fireAt).toEqual(new Date('2026-05-21T04:40:00'));
    expect(window.nativeReminders.schedule).toHaveBeenCalledTimes(1);
    expect(window.nativeReminders.schedule.mock.calls[0][0]).toHaveLength(7);
  });

  it('clamps typed reminder offsets to the 1-120 minute product range', () => {
    const reminders = loadReminders();

    reminders.setPrayerOffset('fajr', 500);
    expect(reminders.getPrefs().perPrayer.fajr).toBe(120);

    reminders.setPrayerOffset('dhuhr', 0);
    expect(reminders.getPrefs().perPrayer.dhuhr).toBeNull();

    reminders.setPrayerOffset('asr', 1);
    expect(reminders.getPrefs().perPrayer.asr).toBe(1);
  });
});
