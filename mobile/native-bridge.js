// ═══════════════════════════════════════════════════════════════════
// Capacitor native bridge — loaded only inside the mobile shell.
//
// The web app stays framework-agnostic; this file detects Capacitor at
// runtime and swaps in native plugins where they materially win:
//
//   - geolocation: Capacitor Geolocation is faster + more accurate than
//     navigator.geolocation in WebView
//   - reminders:   LocalNotifications fire even when the app is closed,
//     unlike the Web Notifications API which requires the page to be open
//   - api base:    points at production https://takbeertime.com instead
//     of whatever localhost the web app would have defaulted to
//
// All of these are no-ops in a regular browser — `window.Capacitor` is
// undefined there and the early-return at the top kicks us out.
// ═══════════════════════════════════════════════════════════════════

(() => {
  const isNative =
    typeof window !== 'undefined' &&
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform();

  if (!isNative) return;

  // ── 0. Mark the document so native-only CSS can scope itself ──────
  // Anything gated by `body.is-native { ... }` only kicks in inside the
  // Capacitor shell. The web build at takbeertime.com is unaffected.
  // Also inject black bands behind the system status bar (top) and
  // gesture pill (bottom) so the white system icons stay readable.
  // Pseudo-elements (::before/::after) on body weren't holding their
  // position:fixed under WebView scroll — real DOM elements do.
  function setupNativeShell() {
    document.body.classList.add('is-native');
    if (!document.getElementById('native-status-band')) {
      const top = document.createElement('div');
      top.id = 'native-status-band';
      const bot = document.createElement('div');
      bot.id = 'native-gesture-band';
      document.body.appendChild(top);
      document.body.appendChild(bot);
    }
  }
  if (document.body) {
    setupNativeShell();
  } else {
    document.addEventListener('DOMContentLoaded', setupNativeShell, { once: true });
  }

  // ── 1. API base URL ────────────────────────────────────────────────
  // The web app is served from takbeertime.com in the browser. In the
  // native shell we're loading from `capacitor://localhost`, so any
  // relative `/api/...` fetch would fail. Pin the backend explicitly.
  // The server mounts the API under /api (verified: GET /api/mosques 200).
  window.JAMAT_CONFIG = window.JAMAT_CONFIG || {};
  window.JAMAT_CONFIG.apiBase = 'https://takbeertime.com/api';
  window.JAMAT_CONFIG.devAuthEnabled = false;
  window.JAMAT_CONFIG.isNative = true;

  // ── 2. Geolocation shim ────────────────────────────────────────────
  // js/app.js calls navigator.geolocation.getCurrentPosition. Wrap it so
  // that on native we go through the Capacitor plugin (uses Core Location
  // / FusedLocationProvider, no browser permission prompt UX).
  //
  // Permission flow on Android 12+: the OS shows a "Precise / Approximate"
  // toggle in the dialog. If we skip requestPermissions(), Capacitor falls
  // back to whatever was previously granted — which on this device was
  // COARSE only, putting the user kilometers off. Asking explicitly for
  // 'location' (FINE) gives the user the chance to upgrade to Precise.
  const Plugins = window.Capacitor?.Plugins || {};
  const Geolocation = Plugins.Geolocation;
  if (Geolocation && navigator.geolocation) {
    const orig = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = async (success, error, opts = {}) => {
      try {
        // Best-effort permission request first. If the user already granted
        // Precise, this is a no-op. If they granted only Approximate or
        // denied, this re-prompts them to upgrade.
        try {
          const status = await Geolocation.checkPermissions();
          if (status.location !== 'granted') {
            await Geolocation.requestPermissions({ permissions: ['location'] });
          }
        } catch { /* older plugin versions: skip silently */ }

        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: opts.enableHighAccuracy ?? true,
          timeout: opts.timeout ?? 10_000,
        });
        success({
          coords: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            altitudeAccuracy: pos.coords.altitudeAccuracy,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
          },
          timestamp: pos.timestamp,
        });
      } catch (e) {
        if (error) error({ code: 1, message: e?.message || 'native geo failed' });
        else orig(success, error, opts);
      }
    };
  }

  // ── 3. Reminders shim ──────────────────────────────────────────────
  // js/reminders.js uses Web Notifications + setTimeout, which dies when
  // the app is backgrounded. Expose `window.nativeReminders` so reminders.js
  // can prefer it when present and fall back to Web Notifications otherwise.
  const LocalNotifications = Plugins.LocalNotifications;
  if (LocalNotifications) {
    let nextId = 1;

    // Dedicated Android channel for prayer reminders. On Android 8+,
    // every notification must go through a channel — and the channel's
    // settings (importance, sound, vibration) override any per-message
    // `sound`/`importance` field. Without an explicit channelId the
    // plugin used the implicit "default" channel, whose sound the user
    // (or the OS) could have silenced — symptom: reminder fires
    // visually as a tray banner but plays no sound.
    //
    // Importance 5 = IMPORTANCE_HIGH = makes sound + heads-up. We want
    // both: prayer reminders are time-sensitive and the user explicitly
    // opted in by enabling the bell, so heads-up is appropriate.
    //
    // No `sound` field → the channel uses the device's default
    // notification sound, which respects the user's chosen ringtone
    // and Do-Not-Disturb settings.
    //
    // Channel is created eagerly on launch. createChannel is idempotent
    // on the OS side (no-op if the channel already exists with these
    // exact settings); the user can still override the sound/importance
    // from system Settings, and Android remembers their choice.
    // Channel ID is versioned. When we change channel config (sound,
    // importance, vibration), Android refuses to update an existing
    // channel — the user owns the channel after first creation and
    // subsequent createChannel() calls are no-ops. The fix is to bump
    // the suffix and recreate. v2 ships the bundled prayer_chime.wav
    // as the channel sound, because relying on
    // `content://settings/system/notification_sound` failed silently
    // when the user has set their system notification sound to "None"
    // (verified on this device — `settings get system
    // notification_sound` returned `null`, which is exactly how a
    // channel pointing at it ended up silent).
    // v3: bumped from v2 so a replaced res/raw/prayer_chime.wav (the custom
    // reminder sound) actually takes effect — Android won't update an
    // existing channel's sound, so a new channel id is the only way to make
    // the OS re-read the WAV for users who already created v2.
    const PRAYER_CHANNEL_ID = 'prayer-reminders-v3';
    if (LocalNotifications.createChannel) {
      // Best-effort cleanup of the old channels so they don't linger
      // in the user's Settings UI. deleteChannel is a no-op if the
      // channel doesn't exist.
      if (LocalNotifications.deleteChannel) {
        LocalNotifications.deleteChannel({ id: 'prayer-reminders' }).catch(() => {});
        LocalNotifications.deleteChannel({ id: 'prayer-reminders-v2' }).catch(() => {});
      }
      LocalNotifications.createChannel({
        id: PRAYER_CHANNEL_ID,
        name: 'Prayer reminders',
        description: 'Reminders before each jamat at your default masjid',
        importance: 5,
        visibility: 1,   // public on lock screen — title only
        vibration: true,
        // Filename without extension — Capacitor resolves to res/raw/
        // <name>.wav at notification time. The sound is generated by
        // mobile/scripts/gen-chime-wav.js (a small two-note chime).
        sound: 'prayer_chime',
      }).catch(() => {});
    }
    // Expose for the schedule / fireTest paths below.
    window.__prayerChannelId = PRAYER_CHANNEL_ID;

    // ── Targeted prayer-reminder cancellation ─────────────────────────
    // We intentionally do NOT cancel every pending notification, because
    // keeper-update / new-suggestion banners (showLocalBanner above) ride
    // through the same LocalNotifications plugin and would get nuked too.
    // The discriminator is `extra.type === 'prayer_reminder'`, set by
    // js/reminders.js when it builds the schedule items.
    //
    // Legacy migration: pre-upgrade prayer reminders have NO extra.type
    // (the field didn't exist). showLocalBanner banners always carry
    // extra.type = 'schedule_update' | 'new_suggestion', so anything in
    // pending with no extra.type is definitionally a legacy prayer
    // reminder. Sweep those too — otherwise they linger forever (their
    // discriminator never matches) and fire alongside the new clean
    // schedule, doubling up the user's notifications.
    function isPrayerReminderEntry(n) {
      const t = n?.extra?.type;
      if (t === 'prayer_reminder' || t === 'prayer_reminder_test') return true;
      if (!t) return true; // legacy
      return false;
    }
    async function cancelPendingPrayerReminders() {
      try {
        const pending = await LocalNotifications.getPending();
        const ours = (pending.notifications || []).filter(isPrayerReminderEntry);
        if (ours.length) {
          await LocalNotifications.cancel({
            notifications: ours.map(n => ({ id: n.id })),
          });
        }
      } catch { /* best-effort */ }
    }

    // ── Stale-reminder sweep ──────────────────────────────────────────
    // Two distinct cleanups:
    //   1. Pending alarms whose fire time is already past — Android's
    //      AlarmManager catches up on missed alarms when the device
    //      wakes from Doze, so a 4:50 PM reminder the OS held back
    //      will fire at app-open at 5:30 PM telling the user to "head
    //      out for Maghrib" half an hour after Maghrib. Drop them
    //      before the OS gets the chance.
    //   2. Delivered tray entries whose target prayer time has
    //      already passed (>60s ago). Stale notifications sitting in
    //      the tray after the prayer started are noise. Don't touch
    //      keeper-update banners — those are time-independent.
    async function cleanupStalePrayerReminders() {
      const now = Date.now();
      try {
        const pending = await LocalNotifications.getPending();
        const stale = (pending.notifications || []).filter(n => {
          if (!isPrayerReminderEntry(n)) return false;
          // Legacy entries (no extra.type/fireAtMs) → treat as stale on
          // launch. We can't tell from the OS what their original fire
          // time was, but reminders.schedule() will re-install whatever
          // is still in the future immediately after this sweep.
          if (!n?.extra?.type) return true;
          const at = Number(n.extra.fireAtMs);
          return Number.isFinite(at) && at <= now;
        });
        if (stale.length) {
          await LocalNotifications.cancel({
            notifications: stale.map(n => ({ id: n.id })),
          });
        }
      } catch { /* best-effort */ }
      if (LocalNotifications.getDeliveredNotifications && LocalNotifications.removeDeliveredNotifications) {
        try {
          const delivered = await LocalNotifications.getDeliveredNotifications();
          const stale = (delivered.notifications || []).filter(n => {
            if (!isPrayerReminderEntry(n)) return false;
            // Legacy delivered (no extra) → drop on launch. The user is
            // here now; a banner about a prayer that already happened
            // is just clutter. Keeper-update banners have extra.type set
            // to a non-prayer value so they survive this filter.
            if (!n?.extra?.type) return true;
            const target = Number(n.extra.targetAtMs);
            return Number.isFinite(target) && target <= now - 60_000;
          });
          if (stale.length) {
            await LocalNotifications.removeDeliveredNotifications({ notifications: stale });
          }
        } catch { /* best-effort */ }
      }
    }

    // ── Exact-alarm permission (Android 12+) ──────────────────────────
    // SCHEDULE_EXACT_ALARM is declared in AndroidManifest.xml, but on
    // Android 12+ the user must still toggle "Alarms & reminders" on in
    // app settings — it can be denied or revoked. Without it the plugin
    // silently downgrades setExactAndAllowWhileIdle() to inexact alarms,
    // which Doze can defer by hours. checkExactNotificationSetting tells
    // us the actual state; changeExactNotificationSetting deep-links the
    // user to the right OS settings page.
    async function checkExactAlarmState() {
      if (!LocalNotifications.checkExactNotificationSetting) return null;
      try {
        const r = await LocalNotifications.checkExactNotificationSetting();
        return r?.exact_alarm || null;
      } catch { return null; }
    }
    async function openExactAlarmSettings() {
      if (!LocalNotifications.changeExactNotificationSetting) return false;
      try {
        await LocalNotifications.changeExactNotificationSetting();
        return true;
      } catch { return false; }
    }
    let exactSettingsPrompted = false;
    async function warnIfExactAlarmDenied({ openSettings = false } = {}) {
      const exact = await checkExactAlarmState();
      if (exact && exact !== 'granted') {
        window.dispatchEvent(new CustomEvent('takbeer:exact-alarm-denied', {
          detail: { state: exact },
        }));
        if (openSettings && !exactSettingsPrompted) {
          exactSettingsPrompted = true;
          await openExactAlarmSettings();
        }
      }
      return exact;
    }

    window.nativeReminders = {
      async ensurePermission() {
        const r = await LocalNotifications.requestPermissions();
        const ok = r.display === 'granted';
        if (ok) {
          // Even with display permission, exact-alarm may be denied. On
          // Android 12+, denied exact alarms are the main cause of
          // reminders arriving tens of minutes or even an hour late
          // under Doze. Send the user to the OS "Alarms & reminders"
          // screen the first time they try to arm reminders.
          await warnIfExactAlarmDenied({ openSettings: true });
        }
        return ok;
      },
      async cancelAll() {
        // Prayer-reminder-scoped cancel. Other notification kinds
        // (keeper updates, new-suggestion banners) are untouched.
        await cancelPendingPrayerReminders();
      },
      // schedule([{title, body, fireAt: Date, extra: {...}}, ...])
      async schedule(items) {
        await cancelPendingPrayerReminders();
        const now = Date.now();
        const notifications = items
          .filter(it => {
            // Defense in depth: js/reminders.js already guards against
            // past fireAt, but if anything ever feeds us a stale item
            // we don't want LocalNotifications.schedule({ at: <past> })
            // to fire it immediately.
            const at = it.fireAt instanceof Date ? it.fireAt.getTime() : new Date(it.fireAt).getTime();
            return Number.isFinite(at) && at > now;
          })
          .map(it => {
            const at = it.fireAt instanceof Date ? it.fireAt : new Date(it.fireAt);
            return {
              id: nextId++,
              title: it.title,
              body: it.body,
              // allowWhileIdle: true switches Capacitor's Android plugin
              // from AlarmManager.set() (which Doze fully suppresses) to
              // setExactAndAllowWhileIdle() (which fires through Doze).
              // This is THE fix for "app was backgrounded since morning,
              // 5:00 PM reminder never rang, then fired at 5:30 PM when
              // the user opened the app". Pairs with SCHEDULE_EXACT_ALARM
              // in AndroidManifest.xml + the user-facing
              // "Alarms & reminders" toggle on Android 12+.
              schedule: { at, allowWhileIdle: true },
              // Explicit sound + channel: belt and braces. The channel
              // already has prayer_chime as its sound, but Capacitor's
              // Android plugin always calls setSound() on the Notification
              // builder; if we omit `sound` here it sets it to null,
              // which overrides the channel sound. So we mirror the
              // channel's sound at the per-notification level too.
              channelId: PRAYER_CHANNEL_ID,
              sound: 'prayer_chime',
              smallIcon: 'ic_stat_icon',
              // Carry the metadata through to the OS — getPending() and
              // getDeliveredNotifications() return it, and our cleanup
              // helpers above filter on extra.type / extra.fireAtMs /
              // extra.targetAtMs. Also acts as a discriminator so
              // cancelPendingPrayerReminders leaves keeper-update
              // banners alone.
              extra: it.extra || { type: 'prayer_reminder' },
            };
          });
        if (notifications.length) {
          await warnIfExactAlarmDenied({ openSettings: true });
        }
        if (notifications.length) await LocalNotifications.schedule({ notifications });
      },
      // Fires a single near-immediate notification through the same
      // channel real reminders use, so the user can tap "Test sound"
      // and actually hear what a reminder will sound like (rather than
      // just the in-app Web Audio chime, which bypasses the OS notification
      // pipeline).
      //
      // We use a fresh ID per call (derived from the current second)
      // rather than reusing one — Android applies ONLY_ALERT_ONCE to
      // notification updates, which would silence repeat taps if we
      // shared an ID. With distinct IDs the OS treats every test as a
      // brand-new alert and rings every time. The IDs auto-recycle on
      // the second-of-epoch boundary so the user's tray doesn't fill
      // up with old test entries (Android also applies AUTO_CANCEL,
      // so they clear when tapped or swept).
      async fireTest() {
        // Modulo keeps the value inside Java int (2^31-1) which is what
        // the plugin requires for notification IDs.
        const id = Math.floor(Date.now() / 1000) % 2_000_000_000;
        // 3 seconds gives the OS enough time to commit the schedule
        // before firing — too short and some Android builds drop it.
        // Explicit sound: Capacitor always calls setSound() on the
        // Android Notification, and an absent / null sound silences
        // the channel-level sound. Pinning to the bundled raw
        // resource means the user hears the chime regardless of
        // their system notification-sound setting.
        // allowWhileIdle here too, so the test exercises the same
        // AlarmManager path real reminders use — no point testing the
        // sound through a different code path than production.
        // extra.type='prayer_reminder_test' so the cleanup sweep treats
        // it distinctly from real prayer reminders (won't get cancelled
        // by a parallel reminders.schedule() racing against this test).
        await LocalNotifications.schedule({
          notifications: [{
            id,
            title: 'Reminder test',
            body: 'This is what a reminder will sound like.',
            schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true },
            channelId: PRAYER_CHANNEL_ID,
            sound: 'prayer_chime',
            smallIcon: 'ic_stat_icon',
            extra: { type: 'prayer_reminder_test' },
          }],
        });
      },
      // UI calls these when the "reminders may be delayed — open
      // settings" banner is shown after a takbeer:exact-alarm-denied
      // event. checkExactAlarm returns 'granted' | 'denied' | 'prompt'
      // | null (null on iOS or Android <12).
      checkExactAlarm: checkExactAlarmState,
      openExactAlarmSettings,
    };

    // ── Dars local reminders ──────────────────────────────────────────
    // Per-member "remind me N minutes before each lesson" schedules local
    // notifications on the dedicated dars channel (same custom sound). Kept
    // separate from the prayer-reminder cancel scope so cancelling one never
    // wipes the other. IDs are derived from the session id so a re-schedule
    // replaces rather than stacks. extra.type='dars_local' + groupId lets the
    // cancel path target exactly this group's local reminders.
    function darsLocalId(sessionId) {
      let h = 0;
      const key = `dars_local:${sessionId}`;
      for (let i = 0; i < key.length; i++) { h = ((h << 5) - h) + key.charCodeAt(i); h |= 0; }
      return (Math.abs(h) % 2_000_000_000) || 1;
    }
    window.takbeerLocalDars = {
      // items: [{ sessionId, title, body, fireAt: Date, groupId }]
      async schedule(items) {
        if (!Array.isArray(items) || !items.length) return;
        const now = Date.now();
        const notifications = items
          .filter(it => it.fireAt && new Date(it.fireAt).getTime() > now)
          .map(it => ({
            id: darsLocalId(it.sessionId),
            title: it.title || 'Dars reminder',
            body: it.body || 'Your Dars is starting soon.',
            schedule: { at: new Date(it.fireAt), allowWhileIdle: true },
            channelId: 'dars-reminders-v1',
            sound: 'prayer_chime',
            smallIcon: 'ic_stat_icon',
            extra: { type: 'dars_local', groupId: it.groupId },
          }));
        if (notifications.length) await LocalNotifications.schedule({ notifications });
      },
      // Cancel this group's pending local dars reminders (or all if no id).
      async cancel(groupId) {
        try {
          const pending = await LocalNotifications.getPending();
          const ids = (pending?.notifications || [])
            .filter(n => n?.extra?.type === 'dars_local' && (!groupId || n.extra.groupId === groupId))
            .map(n => ({ id: n.id }));
          if (ids.length) await LocalNotifications.cancel({ notifications: ids });
        } catch { /* best-effort */ }
      },
    };

    // Run a stale sweep at startup so the user doesn't see a leftover
    // "Maghrib in 10 min" tray entry from before the upgrade, and so
    // any past-time pending alarm the OS would catch up on gets
    // cancelled before it fires. Defer to after the WebView is settled
    // (and after document.body exists) so getPending doesn't race the
    // plugin's own boot.
    const kickoffStaleSweep = () => { cleanupStalePrayerReminders().catch(() => {}); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', kickoffStaleSweep, { once: true });
    } else {
      setTimeout(kickoffStaleSweep, 0);
    }
    // Re-sweep on every resume. The takbeer:resumed event is dispatched
    // by the appStateChange listener further below; piggybacking on it
    // keeps the LocalNotifications scope self-contained instead of
    // reaching across to add another addListener call. The user
    // returning to the app is exactly the moment to drop tray entries
    // for prayers that have already passed.
    window.addEventListener('takbeer:resumed', kickoffStaleSweep);
  }

  // ── 3.5. Permission revocation watcher ─────────────────────────────
  // Android (and iOS) let users revoke a previously-granted permission
  // via OS Settings → Apps → Takbeer → Permissions. When that happens
  // while the app is backgrounded, our scheduled reminders silently
  // stop firing and pushes silently stop displaying — the user thinks
  // the app is broken. On every resume we re-check the permissions we
  // care about; if anything went granted → denied, we dispatch a
  // CustomEvent the UI listens for and renders a "re-enable in
  // Settings" banner over.
  const PERM_KEY = 'takbeer_perm_state_v1';
  const readPermState = () => {
    try { return JSON.parse(localStorage.getItem(PERM_KEY) || '{}'); }
    catch { return {}; }
  };
  const writePermState = (s) => {
    try { localStorage.setItem(PERM_KEY, JSON.stringify(s)); } catch {}
  };

  async function checkAllPermissions() {
    const out = { notifications: 'unknown', location: 'unknown' };
    try {
      const Push = Plugins.PushNotifications;
      if (Push) {
        const r = await Push.checkPermissions();
        out.notifications = r.receive; // 'granted' | 'denied' | 'prompt'
      }
    } catch {}
    try {
      const Geo = Plugins.Geolocation;
      if (Geo) {
        const r = await Geo.checkPermissions();
        out.location = r.location; // 'granted' | 'denied' | 'prompt'
      }
    } catch {}
    return out;
  }

  // Best-effort deep-link to OS app-settings. Capacitor 7 has no first-
  // party plugin for this; we use App.openUrl with the Android intent
  // URL scheme, which Android's IntentResolver routes to the app's
  // details page. If that fails (older WebView, iOS), surface the
  // manual instructions via the resolution path.
  async function openAppSettings() {
    const App = Plugins.App;
    if (!App?.openUrl) return false;
    const intentUrl = 'intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:com.takbeertime.android;end';
    try {
      const res = await App.openUrl({ url: intentUrl });
      return !!res?.completed;
    } catch {
      return false;
    }
  }

  // ── First-run permission onboarding ───────────────────────────────
  // Product decision (overrides the earlier "ask only when the value is
  // obvious" lazy model): request the permissions the app depends on at
  // first launch, so prayer reminders and "masjids near me" work the
  // moment the user needs them instead of silently no-opping for lack of
  // a grant. Runs exactly once, gated by a localStorage flag. The lazy
  // request paths elsewhere (Geolocation shim, Push.ensureRegistered,
  // nativeReminders.ensurePermission) all short-circuit when a permission
  // is already granted, so front-loading here means they never re-prompt
  // — the single grant is reused everywhere.
  const FIRST_PERM_KEY = 'takbeer_first_perm_v1';
  async function runFirstStartPermissions() {
    if (localStorage.getItem(FIRST_PERM_KEY)) return false;

    // 1. Notifications. On Android 13+ this is the POST_NOTIFICATIONS
    //    runtime dialog; requesting it through LocalNotifications grants the
    //    same OS permission that Push relies on, so one ask covers prayer
    //    reminders AND keeper-update pushes. createChannel already ran on
    //    launch, so the channel exists the instant permission lands.
    let notifGranted = false;
    try {
      if (LocalNotifications?.requestPermissions) {
        const r = await LocalNotifications.requestPermissions();
        notifGranted = r?.display === 'granted';
      } else if (Plugins.PushNotifications?.requestPermissions) {
        const r = await Plugins.PushNotifications.requestPermissions();
        notifGranted = r?.receive === 'granted';
      }
    } catch { /* user declined / older OS — handled lazily later */ }

    // 2. Location (FINE) for the nearby-masjid search and sun-position times.
    try {
      if (Geolocation?.requestPermissions) {
        await Geolocation.requestPermissions({ permissions: ['location'] });
      }
    } catch { /* declined — geolocation shim re-prompts on first use */ }

    // Mark first-run done only AFTER the two runtime dialogs have been answered
    // (not before), so a launch interrupted mid-dialog retries the prompts next
    // time instead of permanently consuming the one-time ask.
    try { localStorage.setItem(FIRST_PERM_KEY, String(Date.now())); } catch {}

    // 3. Exact alarms (Android 12+, and NOT granted by default on 14+).
    //    There is no runtime dialog for this — the OS "Alarms & reminders"
    //    toggle is the only way to grant it — so when it isn't already on we
    //    take the user straight there as part of the first-start ask. Only
    //    bother if notifications were granted (a reminder can't fire without
    //    them). On devices where exact alarms are pre-granted this is a no-op.
    if (notifGranted) {
      try {
        const exact = await window.nativeReminders?.checkExactAlarm?.();
        if (exact && exact !== 'granted') {
          // firstRun flag: the UI suppresses its "reminders may be delayed"
          // toast here — the user hasn't armed any reminder yet, and the
          // Settings page we open next is self-explanatory.
          window.dispatchEvent(new CustomEvent('takbeer:exact-alarm-denied', { detail: { state: exact, firstRun: true } }));
          await window.nativeReminders?.openExactAlarmSettings?.();
        }
      } catch {}
    }

    // Refresh the baseline snapshot so the revocation watcher diffs against
    // the freshly-granted state instead of firing a false "revoked" later.
    try { await evaluatePermissionDiff(); } catch {}
    return true;
  }

  window.takbeerPermissions = {
    check: checkAllPermissions,
    openAppSettings,
    // Front-load the permissions the app depends on (idempotent; no-op
    // after the first run). Exposed so the UI / tests can trigger it too.
    requestFirstRun: runFirstStartPermissions,
    // Force a re-read + diff-and-dispatch right now (used by the UI when
    // the user dismisses the banner so we don't immediately re-show it).
    refresh: () => evaluatePermissionDiff(),
  };

  // QA-only sentinel: i18n.js resets document.title on bundle load, so
  // we surface watcher state via a dedicated DOM node that uiautomator
  // can read via the a11y tree.
  function writeQaSentinel(s) {
    let n = document.getElementById('qa-perm-status');
    if (!n) {
      n = document.createElement('div');
      n.id = 'qa-perm-status';
      n.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
      (document.body || document.documentElement).appendChild(n);
    }
    n.textContent = s;
  }

  async function evaluatePermissionDiff() {
    const next = await checkAllPermissions();
    const prev = readPermState();
    writeQaSentinel(`[QA-perm] prev=${JSON.stringify(prev)} next=${JSON.stringify(next)}`);
    writePermState(next);
    // Only fire the revoked event if we have a *previous* granted state
    // — the first run won't fire a stale "revoked" alarm.
    const revoked = [];
    for (const key of ['notifications', 'location']) {
      if (prev[key] === 'granted' && next[key] === 'denied') revoked.push(key);
    }
    if (revoked.length) {
      writeQaSentinel('[QA-perm] FIRED ' + revoked.join(','));
      window.dispatchEvent(new CustomEvent('takbeer:permission-revoked', {
        detail: { which: revoked, current: next },
      }));
    }
    return next;
  }

  // Run an initial baseline read so we have something to diff against.
  // Then wire the resume hook (Capacitor App plugin emits 'appStateChange'
  // with { isActive }; the alias 'resume' isn't in v7).
  //
  // Timing matters: native-bridge.js loads BEFORE app.js, so the
  // CustomEvent dispatched by evaluatePermissionDiff would fire into the
  // void if the page-level listener hadn't been attached yet. Defer the
  // first call to the next macrotask after DOMContentLoaded to give
  // app.js's wirePermissionRevocationBanner time to subscribe.
  const kickoff = () => setTimeout(() => {
    // Read the baseline permission state first (so the revocation watcher
    // has something to diff against), then — on the very first launch —
    // front-load the OS permission prompts. The ~900ms delay lets the home
    // screen paint behind the dialog so the ask has visible context instead
    // of landing on a bare splash.
    Promise.resolve(evaluatePermissionDiff()).finally(() => {
      setTimeout(() => { runFirstStartPermissions().catch(() => {}); }, 900);
    });
  }, 0);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kickoff, { once: true });
  } else {
    kickoff();
  }
  const App2 = Plugins.App;
  if (App2?.addListener) {
    App2.addListener('appStateChange', (state) => {
      if (state?.isActive) {
        evaluatePermissionDiff();
        window.takbeerPush?.flushPending?.().catch(() => {});
        // Resume tick: app.js listens and refreshes the inbox so the bell
        // badge isn't stale after the user switched apps. Without this the
        // user could miss a suggestion that arrived while backgrounded
        // unless they fully relaunched the app.
        window.dispatchEvent(new CustomEvent('takbeer:resumed'));
      }
    });
  }

  // ── 4. Hardware back button ────────────────────────────────────────
  // Default Capacitor behavior on Android back press is to call
  // window.history.back(), which on this single-page app does nothing
  // when the user is already at the home screen — so the press feels
  // dead. Users expect back at home to drop the app to the background
  // (same as pressing Home). Inside a drawer or modal, back should
  // close it first.
  //
  // Registering any listener disables the default, so this handler is
  // the sole authority for back-button behavior in the native shell.
  const App = Plugins.App;
  if (App && App.addListener) {
    App.addListener('backButton', async () => {
      // 1. Close the bottom drawer if it's open. Click the close button
      //    so any history-back / state cleanup the app already wired up
      //    runs (matches the × button's behavior).
      const drawer = document.getElementById('drawer');
      if (drawer && drawer.getAttribute('aria-hidden') === 'false') {
        const closer = drawer.querySelector('[data-close-drawer]');
        if (closer) closer.click();
        else drawer.setAttribute('aria-hidden', 'true');
        return;
      }

      // 2. Close any open modal (login, inbox, suggest).
      const openModal = document.querySelector('.modal[aria-hidden="false"]');
      if (openModal) {
        const closer = openModal.querySelector('[data-close-modal]');
        if (closer) closer.click();
        else openModal.setAttribute('aria-hidden', 'true');
        return;
      }

      // 3. Hash-based sub-route open (e.g. #mosque/<id>) — pop history.
      if (location.hash && location.hash !== '#' && location.hash.length > 1) {
        history.back();
        return;
      }

      // 4. Home — minimize like the system Home button. exitApp() would
      //    actually finish the activity, which is more aggressive than
      //    users expect from a single back press.
      try {
        if (App.minimizeApp) await App.minimizeApp();
        else if (App.exitApp) await App.exitApp();
      } catch { /* fall through silently */ }
    });
  }

  // ── 5. Push notifications (FCM topics) ────────────────────────────
  // Followers of a time keeper subscribe to `keeper-<keeperId>-mosque-
  // <mosqueId>` topics; the server fires to that topic when the keeper
  // submits new times. Foreground messages silently re-fetch the masjid
  // (the app re-renders without UI noise); background taps deep-link to
  // the masjid drawer. See docs/PUSH_NOTIFICATIONS.md for the contract
  // both sides build to.
  //
  // Topic subscription itself isn't in @capacitor/push-notifications —
  // we use @capacitor-community/fcm for that. The two plugins coexist:
  // PushNotifications handles permission/channels/listeners, FCM handles
  // subscribeTo / unsubscribeFrom.
  const Push = Plugins.PushNotifications;
  const FCM = Plugins.FCM;
  if (Push) {
    // Create the keeper-updates channel eagerly on every launch.
    // Channel creation needs no permission and no FCM token — it's just
    // an Android NotificationManager call describing how a notification
    // *would* look if one arrives. Without this, a push'd land before
    // the user had ever tapped Follow (FCM topic subscriptions persist
    // across reinstalls), so ensureRegistered hadn't run yet, the
    // channel didn't exist, and Android routed the banner to
    // `channel=default` with the wrong importance and missing the spec'd
    // styling. Server payload pins channelId='keeper-updates', so the
    // channel must exist before any push could plausibly land.
    if (Push.createChannel) {
      Push.createChannel({
        id: 'keeper-updates',
        name: 'Keeper updates',
        description: 'When a time keeper you follow updates a masjid schedule',
        importance: 4,
        vibration: true,
      }).catch(() => {});
      // Dedicated high-importance channel for Dars reminders, carrying the
      // same custom sound as prayer reminders (res/raw/prayer_chime.wav).
      // Kept separate from keeper-updates so muting/keeping it is independent
      // and it reads as "Dars reminders" in the system settings. Versioned
      // (-v1) so a future sound change can force a recreate the same way the
      // prayer channel does. Server pins channelId='dars-reminders-v1'.
      Push.createChannel({
        id: 'dars-reminders-v1',
        name: 'Dars reminders',
        description: 'Reminders to attend a Dars lesson in a group you joined',
        importance: 5,
        visibility: 1,
        vibration: true,
        sound: 'prayer_chime',
      }).catch(() => {});
    }

    let registered = false;
    // Concurrent followKeeper taps would otherwise both run Push.register()
    // in parallel. The plugin handles that, but sharing a single in-flight
    // Promise is cleaner and means we ask for permission exactly once.
    let registerPromise = null;

    async function ensureRegistered() {
      if (registered) return true;
      if (registerPromise) return registerPromise;
      registerPromise = (async () => {
        // Android 13+ needs runtime POST_NOTIFICATIONS; older versions
        // grant on install. iOS is always a runtime prompt. We bundle
        // the prompt into the first follow action so the user only sees
        // it when the value is obvious ("you wanted updates from this
        // keeper") — never on cold launch.
        try {
          let perm = await Push.checkPermissions();
          if (perm.receive !== 'granted') {
            perm = await Push.requestPermissions();
            if (perm.receive !== 'granted') return false;
          }
          await Push.register();
          registered = true;
          return true;
        } catch {
          return false;
        } finally {
          // On failure, allow a future call to retry from scratch.
          // On success, `registered` is true so the early-return wins.
          if (!registered) registerPromise = null;
        }
      })();
      return registerPromise;
    }

    // Foreground push handler. Capacitor's PushNotifications plugin only
    // displays an OS banner when the app is *backgrounded*; while
    // foregrounded, the message is delivered to JS only. To keep the
    // user aware of incoming updates regardless of foreground state, we
    // also schedule a local notification with the same title/body — the
    // OS shows the banner in the tray either way. The dispatched
    // CustomEvents still drive in-app silent refresh so the hero/inbox
    // reflects the new state without the user needing to tap anything.
    //
    // ID via stableId(): a deterministic int derived from a key string so
    // a re-send with the same key (same mosqueId / suggestionId) replaces
    // rather than stacks the banner.
    function stableId(key) {
      let h = 0;
      for (let i = 0; i < key.length; i++) {
        h = ((h << 5) - h) + key.charCodeAt(i);
        h |= 0; // 32-bit signed
      }
      return Math.abs(h) || 1;
    }
    async function showLocalBanner(opts) {
      if (!LocalNotifications) return;
      try {
        await LocalNotifications.schedule({
          notifications: [{
            id: opts.id,
            title: opts.title || 'Takbeer Time',
            body: opts.body || '',
            channelId: opts.channelId || 'keeper-updates',
            // Mirror the channel sound at the message level too (Capacitor's
            // Android plugin nulls the sound otherwise — see the reminder
            // schedule path for the same belt-and-braces).
            sound: opts.sound,
            smallIcon: 'ic_stat_icon',
            extra: opts.extra || {},
          }],
        });
      } catch { /* best-effort; foreground silent refresh still ran */ }
    }

    Push.addListener('pushNotificationReceived', (notification) => {
      const data = notification?.data || {};
      const title = notification?.title;
      const body = notification?.body;
      if (data.type === 'schedule_update' && data.mosqueId) {
        // Silent refresh of the affected masjid.
        window.dispatchEvent(new CustomEvent('takbeer:schedule-update', {
          detail: { mosqueId: data.mosqueId, submitterId: data.submitterId },
        }));
        // ALSO show a tray banner so the user is aware. Without this, a
        // keeper update that arrives while the user is on a different
        // screen of the app passes silently — exactly the gap this commit
        // closes.
        if (title) {
          showLocalBanner({
            id: stableId(`schedule:${data.mosqueId}`),
            title, body,
            extra: { type: 'schedule_update', mosqueId: data.mosqueId },
          });
        }
      } else if (data.type === 'new_suggestion') {
        window.dispatchEvent(new CustomEvent('takbeer:new-suggestion', {
          detail: { suggestionId: data.suggestionId, mosqueId: data.mosqueId },
        }));
        if (title) {
          showLocalBanner({
            id: stableId(`suggest:${data.suggestionId || data.mosqueId}`),
            title, body,
            extra: { type: 'new_suggestion', mosqueId: data.mosqueId, suggestionId: data.suggestionId },
          });
        }
      } else if (data.type === 'dars_reminder' && data.groupId) {
        // Dars group reminder / new-lesson heads-up. Foreground: show a tray
        // banner (the plugin won't on its own) so a member who's mid-app
        // still sees "Dars is starting". Tap routing lives in the action
        // handlers below → deep-links to the group.
        window.dispatchEvent(new CustomEvent('takbeer:dars-reminder', {
          detail: { groupId: data.groupId, kind: data.kind },
        }));
        if (title) {
          showLocalBanner({
            id: stableId(`dars:${data.groupId}`),
            title, body,
            channelId: 'dars-reminders-v1',
            sound: 'prayer_chime',
            extra: { type: 'dars_reminder', groupId: data.groupId },
          });
        }
      }
    });

    // Local-notification tap routes to the same hash as the push tap.
    // The user can't tell the two notifications apart (same channel, same
    // icon, same payload), so they shouldn't behave differently.
    if (LocalNotifications?.addListener) {
      LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const extra = action?.notification?.extra || {};
        if (extra.type === 'schedule_update' && extra.mosqueId) {
          location.hash = `mosque/${extra.mosqueId}`;
        } else if (extra.type === 'new_suggestion') {
          location.hash = 'inbox';
        } else if (extra.type === 'dars_reminder' && extra.groupId) {
          location.hash = `dars/group/${extra.groupId}`;
        }
      });
    }

    // Background tap → deep-link based on push type. The web app wires
    // 'mosque/<id>' and 'inbox' as hash routes in applyHashState (js/app.js);
    // we just push the hash and let the existing handler do the work.
    Push.addListener('pushNotificationActionPerformed', (action) => {
      const data = action?.notification?.data || {};
      if (data.type === 'schedule_update' && data.mosqueId) {
        location.hash = `mosque/${data.mosqueId}`;
      } else if (data.type === 'new_suggestion') {
        // Open the inbox modal directly. Don't navigate to the masjid —
        // the inbox shows the diff context (current vs suggested), which
        // is what the keeper actually needs to act on the suggestion.
        location.hash = 'inbox';
      } else if (data.type === 'dars_reminder' && data.groupId) {
        // Deep-link straight to the Dars group so the member can see the
        // lesson details and jump in.
        location.hash = `dars/group/${data.groupId}`;
      }
    });

    // Track our own subscribed topics so logout can clean them up. Without
    // this, a sign-out leaves the device subscribed to the previous user's
    // followed-keeper topics — a privacy bleed if a different account
    // signs in afterwards on the same device.
    const TOPICS_KEY = 'takbeer_fcm_topics_v1';
    const readTopics = () => {
      try { return new Set(JSON.parse(localStorage.getItem(TOPICS_KEY) || '[]')); }
      catch { return new Set(); }
    };
    const writeTopics = (set) => {
      try { localStorage.setItem(TOPICS_KEY, JSON.stringify([...set])); } catch {}
    };

    // Deferred-subscribe queue. Used by subscribeWhenPermitted() so that
    // signin doesn't trigger the POST_NOTIFICATIONS prompt — we only ask
    // when the value is obvious ("you wanted updates from this keeper").
    // If the user later grants permission via a Follow tap, ensureRegistered
    // succeeds and we drain this queue.
    const PENDING_KEY = 'takbeer_fcm_pending_v1';
    const readPending = () => {
      try { return new Set(JSON.parse(localStorage.getItem(PENDING_KEY) || '[]')); }
      catch { return new Set(); }
    };
    const writePending = (set) => {
      try { localStorage.setItem(PENDING_KEY, JSON.stringify([...set])); } catch {}
    };
    function rememberPendingTopic(topic) {
      if (!topic) return;
      const pending = readPending();
      pending.add(topic);
      writePending(pending);
    }
    function forgetPendingTopic(topic) {
      if (!topic) return;
      const pending = readPending();
      pending.delete(topic);
      writePending(pending);
    }
    async function drainPendingSubscriptions() {
      const pending = [...readPending()];
      if (!pending.length) return;
      const topics = readTopics();
      const stillPending = new Set();
      for (const t of pending) {
        try {
          await FCM.subscribeTo({ topic: t });
          topics.add(t);
        } catch {
          stillPending.add(t); // retry next time
        }
      }
      writeTopics(topics);
      writePending(stillPending);
    }

    // Public API used by app.js inside followKeeper / setPreferredKeeper.
    // No-ops gracefully when FCM plugin isn't present (e.g. running in a
    // pure browser somehow), so callers don't have to platform-check.
    window.takbeerPush = {
      async subscribe(topic) {
        if (!topic || !FCM) return false;
        if (!(await ensureRegistered())) {
          rememberPendingTopic(topic);
          return false;
        }
        try {
          await FCM.subscribeTo({ topic });
          const t = readTopics(); t.add(topic); writeTopics(t);
          forgetPendingTopic(topic);
          // Opportunistically drain any pending subscribes that were
          // queued before permission was granted.
          await drainPendingSubscriptions();
          return true;
        } catch {
          rememberPendingTopic(topic);
          return false;
        }
      },
      // Subscribe ONLY if we already have notif permission; otherwise
      // queue the topic for later (drained on the next ensureRegistered
      // success). Used by signin: we want the keeper to receive
      // suggest-to-<id> pushes IF they've already opted into
      // notifications, but we don't want to prompt them at signin (the
      // ask-only-when-value-is-obvious rule).
      async subscribeWhenPermitted(topic) {
        if (!topic || !FCM || !Push) return false;
        try {
          const perm = await Push.checkPermissions();
          if (perm.receive === 'granted') {
            // Already permitted — full subscribe (which also re-runs
            // Push.register() if we haven't yet this session).
            const ok = await this.subscribe(topic);
            if (!ok) rememberPendingTopic(topic);
            return ok;
          }
        } catch { /* fall through to queue */ }
        // Not yet permitted: queue for later, no prompt.
        rememberPendingTopic(topic);
        return false;
      },
      async flushPending() {
        if (!FCM || !Push) return false;
        try {
          const perm = await Push.checkPermissions();
          if (perm.receive !== 'granted') return false;
        } catch {
          return false;
        }
        if (!(await ensureRegistered())) return false;
        await drainPendingSubscriptions();
        return true;
      },
      async status(topic) {
        let permission = 'unknown';
        try {
          if (Push?.checkPermissions) {
            const perm = await Push.checkPermissions();
            permission = perm.receive || 'unknown';
          }
        } catch {}
        const topics = readTopics();
        const pending = readPending();
        return {
          supported: !!FCM && !!Push,
          permission,
          registered,
          subscribed: !!topic && topics.has(topic),
          pending: !!topic && pending.has(topic),
        };
      },
      async unsubscribe(topic) {
        if (!topic || !FCM) return false;
        try {
          await FCM.unsubscribeFrom({ topic });
          const t = readTopics(); t.delete(topic); writeTopics(t);
          forgetPendingTopic(topic);
          return true;
        } catch { return false; }
      },
      // Logout cleanup: iterate every topic this device subscribed to and
      // tell FCM to drop them. Best-effort — if a single unsubscribe fails
      // we still remove the entry from local state so we don't redo it
      // forever. The FCM token itself is left intact (re-login will reuse
      // it without re-prompting for permission).
      async unsubscribeAll() {
        if (!FCM) return;
        const topics = [...readTopics()];
        await Promise.all(topics.map(t => FCM.unsubscribeFrom({ topic: t }).catch(() => {})));
        writeTopics(new Set());
        // Also clear any queued-but-never-subscribed topics so the next
        // signed-in user doesn't inherit them.
        writePending(new Set());
      },
    };
  }

  // ── 6. Status bar + splash ─────────────────────────────────────────
  const StatusBar = Plugins.StatusBar;
  const SplashScreen = Plugins.SplashScreen;
  if (StatusBar) {
    // Android 15+ enforces edge-to-edge regardless of setOverlaysWebView,
    // and setBackgroundColor is a no-op there. We paint the status-bar
    // safe-area region in CSS (body.is-native::before in jamat.css).
    // Style "DARK" = light/white icons — readable on the black band.
    StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
  }
  if (SplashScreen) {
    // Hide once the page is interactive — main.css/JS has loaded.
    requestAnimationFrame(() => SplashScreen.hide().catch(() => {}));
  }
})();
