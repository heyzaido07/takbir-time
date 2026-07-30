// ═══════════════════════════════════════════════════════════════════
// Jamat Reminders — per-prayer alarms with individual on/off toggles
// AND a Friday-aware Jummah swap.
//
// Each prayer has TWO independent settings:
//   - perPrayer[name]: minutes-before (the saved value, never lost)
//   - prayerEnabled[name]: bool toggle (turn off without losing the value)
//
// Friday handling:
//   - On Friday, Jummah replaces Dhuhr — Dhuhr's reminder is skipped.
//   - On other days, Jummah is skipped.
//
// Persistence: localStorage. Backwards-compatible with older schemas.
// ═══════════════════════════════════════════════════════════════════

const reminders = (() => {
  const STORAGE_KEY = 'jamat_reminder_prefs';
  let timers = [];

  const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'jummah'];
  const DAYS_AHEAD_TO_SCHEDULE = 7;

  function emptyPrayerMap(value = null) {
    return PRAYER_KEYS.reduce((acc, k) => { acc[k] = value; return acc; }, {});
  }

  function defaultPrefs() {
    return {
      enabled: false,                          // master switch
      perPrayer: emptyPrayerMap(null),         // minutes (number | null)
      prayerEnabled: emptyPrayerMap(false),    // per-prayer on/off
    };
  }

  function getPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultPrefs();
      const parsed = JSON.parse(raw);

      // Legacy schema 1: {enabled, minutesBefore} (single global offset)
      if (parsed.minutesBefore != null && !parsed.perPrayer) {
        const m = parsed.enabled ? parsed.minutesBefore : null;
        return {
          enabled: !!parsed.enabled,
          perPrayer: { fajr: m, dhuhr: m, asr: m, maghrib: m, isha: m, jummah: null },
          prayerEnabled: { fajr: !!m, dhuhr: !!m, asr: !!m, maghrib: !!m, isha: !!m, jummah: false },
        };
      }

      // Legacy schema 2: {enabled, perPrayer} (per-prayer minutes, no toggles)
      // Default each toggle to (minutes > 0)
      const perPrayer = { ...emptyPrayerMap(null), ...(parsed.perPrayer || {}) };
      let prayerEnabled;
      if (parsed.prayerEnabled) {
        prayerEnabled = { ...emptyPrayerMap(false), ...parsed.prayerEnabled };
      } else {
        prayerEnabled = {};
        for (const k of PRAYER_KEYS) {
          prayerEnabled[k] = typeof perPrayer[k] === 'number' && perPrayer[k] > 0;
        }
      }
      return {
        enabled: !!parsed.enabled,
        perPrayer,
        prayerEnabled,
      };
    } catch {
      return defaultPrefs();
    }
  }

  function savePrefs(p) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    // Mirror to server so the same user on a second browser sees the same
    // config. Best-effort: failures don't block the local save.
    if (window.api?.putMyReminderPrefs) {
      window.api.putMyReminderPrefs(p).catch(() => {});
    }
  }

  // Hydrate localStorage from a server-provided pref blob (called once after
  // the user signs in / profile loads). Server is the cross-device source of
  // truth; localStorage stays the working copy.
  function hydrateFromServer(serverPrefs) {
    if (!serverPrefs || typeof serverPrefs !== 'object') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serverPrefs));
  }

  /** Set minutes for one prayer. Doesn't change the on/off toggle. */
  function setPrayerOffset(prayer, minutes) {
    const prefs = getPrefs();
    prefs.perPrayer[prayer] = (typeof minutes === 'number' && minutes > 0)
      ? Math.min(120, Math.max(1, Math.round(minutes)))
      : null;
    // If user types a number into a previously-disabled prayer, auto-enable it.
    if (prefs.perPrayer[prayer] != null && !prefs.prayerEnabled[prayer]) {
      prefs.prayerEnabled[prayer] = true;
    }
    // Master enable reflects whether ANY prayer is on with a value.
    prefs.enabled = PRAYER_KEYS.some(k => prefs.prayerEnabled[k] && prefs.perPrayer[k] > 0);
    savePrefs(prefs);
    return prefs;
  }

  /** Toggle one prayer on/off. Preserves the minutes value. */
  function setPrayerEnabled(prayer, enabled) {
    const prefs = getPrefs();
    prefs.prayerEnabled[prayer] = !!enabled;
    prefs.enabled = PRAYER_KEYS.some(k => prefs.prayerEnabled[k] && prefs.perPrayer[k] > 0);
    savePrefs(prefs);
    return prefs;
  }

  async function ensurePermission() {
    // Inside the Capacitor shell, the WebView has no Notification API; ask the
    // OS via the native bridge (mobile/native-bridge.js exposes this).
    if (window.nativeReminders) return window.nativeReminders.ensurePermission();
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  // Optional custom reminder sound for the WEB path (browser/PWA). Drop an
  // audio file at this URL and it plays for namaz (and, via window.reminders,
  // Dars) reminders instead of the built-in synth chime. If the file is
  // missing or blocked (autoplay policy, decode error) we fall back to the
  // synthesized chime so a reminder is never silent. Native (Android) uses
  // the bundled res/raw/prayer_chime.wav via the notification channel instead.
  const CUSTOM_SOUND_URL = 'assets/adhan.mp3';

  function playSynthChime() {
    if (!window.AudioContext && !window.webkitAudioContext) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const notes = [
      { freq: 783.99, when: 0.00, dur: 0.42 },
      { freq: 1046.5, when: 0.18, dur: 0.42 },
      { freq: 659.26, when: 0.40, dur: 0.42 },
      { freq: 880.00, when: 0.62, dur: 0.62 },
    ];
    notes.forEach(n => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = n.freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0, ctx.currentTime + n.when);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + n.when + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + n.when + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + n.when);
      osc.stop(ctx.currentTime + n.when + n.dur + 0.05);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  }

  // Public chime: try the custom audio file first, fall back to the synth.
  // `new Audio().play()` returns a promise that rejects on autoplay block or
  // a missing/undecodable file — in every failure case we play the synth so
  // the reminder still makes a sound.
  function playChime() {
    try {
      const audio = new Audio(CUSTOM_SOUND_URL);
      audio.volume = 0.9;
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        p.catch(() => playSynthChime());
      }
    } catch {
      playSynthChime();
    }
  }

  // Localized notification title/body. Reuses the already-translated
  // prayer.* labels and formats the time via the shared 12h formatter, so
  // non-English users don't get English push text with raw 24h times.
  function notifTexts(prayerKey, time, minutesBefore, mosqueName) {
    const i18n = window.i18n;
    const prettyName = (i18n?.t && i18n.t(`prayer.${prayerKey}`))
      || (prayerKey === 'jummah' ? 'Jummah' : prayerKey.charAt(0).toUpperCase() + prayerKey.slice(1));
    const prettyTime = window.JAMAT_RENDER?.fmt12 ? window.JAMAT_RENDER.fmt12(time) : time;
    const title = i18n?.t
      ? i18n.t('reminders.notifTitle', { prayer: prettyName, mosque: mosqueName })
      : `${prettyName} at ${mosqueName}`;
    const body = i18n?.t
      ? i18n.t('reminders.notifBody', { n: minutesBefore, time: prettyTime })
      : `Jamat in ${minutesBefore} min (at ${prettyTime}). Time to head out.`;
    return { title, body };
  }

  function fire(prayer, time, minutesBefore, mosqueName) {
    // Skip the Web Audio chime in the Capacitor shell — the native
    // LocalNotification's `sound: 'default'` already plays the OS
    // notification tone when the reminder fires. Playing both produced
    // a double-sound (chime + ding within milliseconds of each other).
    // The native path here is reachable only when `fire()` is invoked
    // directly from the WebView while it's foregrounded; on native we
    // schedule via `nativeReminders.schedule(...)` instead, which never
    // calls fire() at all. Belt-and-suspenders guard for the rare case.
    if (!window.nativeReminders) playChime();
    if ('Notification' in window && Notification.permission === 'granted') {
      const { title, body } = notifTexts(prayer, time, minutesBefore, mosqueName);
      const n = new Notification(title, {
        body,
        tag: `jamat-${prayer}-${time}`,
        renotify: true,
        silent: false,
      });
      n.onclick = () => { window.focus(); n.close(); };
    }
  }

  function schedule(timings, mosqueName) {
    cancel();
    const prefs = getPrefs();
    if (!prefs.enabled || !timings) return [];

    const now = new Date();
    const nowMs = now.getTime();
    const scheduled = [];
    const nativeItems = [];

    for (let dayOffset = 0; dayOffset <= DAYS_AHEAD_TO_SCHEDULE; dayOffset += 1) {
      const day = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const isFriday = day.getDay() === 5;

      for (const key of PRAYER_KEYS) {
        // Both the per-prayer toggle AND a positive minutes value must be set.
        if (!prefs.prayerEnabled[key]) continue;
        const minutesBefore = prefs.perPrayer[key];
        if (typeof minutesBefore !== 'number' || minutesBefore <= 0) continue;

        // Friday/Jummah swap, evaluated for the scheduled date.
        if (isFriday && key === 'dhuhr') continue;
        if (!isFriday && key === 'jummah') continue;

        let time = timings[key];
        if (key === 'dhuhr' && !time) time = timings['zuhr'];
        if (Array.isArray(time)) time = time[0];
        // Maghrib tracks the sun — recompute it for the scheduled day instead
        // of committing today's sunset to every future day's OS alarm. Only
        // override an existing Maghrib (a Jummah-only schedule has none).
        if (key === 'maghrib' && time && window.sun
            && Number.isFinite(Number(timings.maghribOffset))
            && timings.lat != null && timings.lng != null) {
          const perDay = window.sun.maghribForMosque(
            { latitude: timings.lat, longitude: timings.lng }, day, Number(timings.maghribOffset));
          if (perDay) time = perDay;
        }
        if (!time || typeof time !== 'string') continue;

        const [h, m] = time.split(':').map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) continue;

        const target = new Date(day);
        target.setHours(h, m, 0, 0);
        const fireAt = target.getTime() - minutesBefore * 60_000;
        if (fireAt <= nowMs) continue;

        if (window.nativeReminders) {
          // Native path — Capacitor LocalNotifications. Survives backgrounding.
          const { title, body } = notifTexts(key, time, minutesBefore, mosqueName);
          nativeItems.push({
            title,
            body,
            fireAt: new Date(fireAt),
            // Metadata the native bridge uses for targeted cancellation +
            // stale-cleanup. Without `type: 'prayer_reminder'` the bridge
            // can't tell our reminders apart from keeper-update banners
            // and would either nuke both or neither. `targetAtMs` is the
            // actual prayer start (used to drop tray entries that have
            // gone past prayer time); `fireAtMs` is the alarm time (used
            // to drop pending alarms that the OS held back through Doze
            // and would otherwise deliver late).
            extra: {
              type: 'prayer_reminder',
              prayerKey: key,
              mosqueName,
              prayerTime: time,
              minutesBefore,
              fireAtMs: fireAt,
              targetAtMs: target.getTime(),
            },
          });
        } else {
          // Web path — setTimeout + Web Notifications. Dies when tab is backgrounded.
          const id = setTimeout(() => fire(key, time, minutesBefore, mosqueName), fireAt - nowMs);
          timers.push(id);
        }
        scheduled.push({ prayer: key, time, minutesBefore, fireAt: new Date(fireAt) });
      }
    }

    if (window.nativeReminders && nativeItems.length) {
      // Fire-and-forget; the OS owns the schedule once accepted.
      window.nativeReminders.schedule(nativeItems).catch(() => {});
    }
    return scheduled;
  }

  function cancel() {
    timers.forEach(id => clearTimeout(id));
    timers = [];
    if (window.nativeReminders) window.nativeReminders.cancelAll().catch(() => {});
  }

  return {
    PRAYER_KEYS,
    getPrefs, savePrefs, setPrayerOffset, setPrayerEnabled,
    hydrateFromServer,
    ensurePermission, playChime,
    schedule, cancel,
    isPermitted: () => {
      // In native shell, the only authoritative answer is from the OS — but
      // checking that is async. Treat the bridge's presence as "we have a
      // path"; ensurePermission() before scheduling is what actually gates.
      if (window.nativeReminders) return true;
      return 'Notification' in window && Notification.permission === 'granted';
    },
  };
})();

window.reminders = reminders;
