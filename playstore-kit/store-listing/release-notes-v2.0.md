# Takbeer Time — v2.0 release notes

## Play Console "What's new" copy

Paste this into Play Console → Production → Release notes (limit: 500 chars
per language). One line for short languages, full version below for English.

### Short (≤500 chars, English)

```
Takbeer Time 2.0 — bigger upgrade.

• Set any masjid as your default with one tap from the list
• Prayer reminders now ring on time even when your phone is asleep
• Refreshed Material Design 3 look across the app
• New launcher icon — no more cropped logo
• Pull down on the home screen to refresh today's times
• Sign in with Google or email/password
• Bundled prayer chime works even when system sound is silenced

Built for the ummah. Open source. Kept honest by volunteers.
```

### Ultra-short (≤170 chars, for Hindi/Bengali/Arabic if needed)

```
Takbeer Time 2.0 — set any masjid as default in one tap, reminders ring through battery saving, refreshed look, new icon, pull-to-refresh.
```

---

## Detailed release note (dev / GitHub release / blog)

### Highlights

**Set any masjid as default in one tap.** Every masjid card in the list
now carries a "Set as default" pill. No need to open the detail drawer
first — pick from the list and the home screen reflects it
immediately. The previously-default masjid demotes in place so you
always see exactly one "✓ Default".

**Reminders survive Doze.** Android's battery saver was silently
suppressing prayer reminders — a 5:00 PM Maghrib alarm could be held
back until you next opened the app, then fire 30 minutes late saying
"head out, jamat in 10 min." That's gone. Reminders now use
`setExactAndAllowWhileIdle` so they ring on time regardless of how
deep the OS has put your phone to sleep. Pairs with the
`SCHEDULE_EXACT_ALARM` permission and a stale-alarm sweep on every
launch so missed-from-sleep alarms don't deliver hours late as a
ghost notification.

**Material 3 design pass.** Switches, buttons, chips, and text fields
across the app updated to Material Design 3 specs. The reminder
toggles, bell, and refresh button now have proper shape tokens,
state layers, and Material Design 3 elevation. The "Your default"
badge is a filled-tonal chip; the per-card pill is an outlined
chip. Subtle stuff, but the whole app reads more polished.

**New launcher icon.** Refined mosque-clock logo. Re-rendered at
the correct adaptive-icon safe-zone scale so Android's round and
squircle masks don't clip the design.

**Pull-to-refresh.** Swipe down on the home screen to pull the
latest jamat times from the server. Replaces the explicit refresh
button as the primary gesture (button is still there for
power users).

**Tappable keeper line on the hero.** "Times by Junaid Qazi" is
now an M3 assist chip — tap it to see the full keeper directory
for the masjid and pick a different time-keeper if you want their
schedule.

**Sign in with Google or email/password.** Both work end-to-end.
Email/password gets you a 30-day app token; Google sign-in
upgrades existing dev-auth users in place rather than creating a
duplicate row.

**Bundled prayer chime.** A short two-note chime is now packaged
in the APK and used as the prayer-reminder channel sound. Replaces
the previous fallback to the system notification sound, which was
silent on devices where the user had set their notification sound
to "None".

### Quality + safety

- Five security audit findings closed (auth claim flow, suggestion
  accept verification, prod environment guard for the dev-auth
  bypass, IPv6 rate-limit keying, duplicate migration cleanup).
- Test ring fires with a live 3-2-1 countdown so you can hear and
  see the reminder path end-to-end.
- Pretty keeper names (`junaid.qazi.veemed` → `Junaid Qazi Veemed`)
  on the hero and in directories.
- Reframed "no times yet" empty state into an invitation:
  "Be the first to submit times" instead of a deficiency note.
- In-app privacy policy, terms, and account-deletion request
  page (also reachable on takbeertime.com — required by Play
  Store policy).
- Hero countdown auto-advances when a prayer time passes, so the
  countdown card never gets stuck on Asr 23 hours away after Asr
  has already started.

### Under the hood

- Capacitor mobile shell, Android target SDK 36 (Android 16).
- Per-prayer `extra.type='prayer_reminder'` metadata on every
  scheduled notification so the bridge can clean stale alarms
  without touching keeper-update push banners.
- Exact-alarm permission (Android 12+) detection + deep-link
  helper exposed to the UI for a future "reminders may be
  delayed" banner.
- Keeper-update FCM push notifications when a time-keeper you
  follow submits new schedules.
- Default Play track on push: `internal`. Promote to production
  from Play Console.

### Known follow-ups

- Translations for the new "Set as default" / "✓ Default" labels
  across the 9 non-English locales (currently fall back to
  English).
- UI banner that listens for the `takbeer:exact-alarm-denied`
  event and surfaces "reminders may be delayed — open settings"
  with a deep-link button.

---

## Where to use this file

- **Play Console** → copy the "Short" block into Release notes.
- **GitHub Releases** → use the Detailed section as the body.
- **takbeertime.com / blog** → the Highlights subsection works as
  a standalone post; trim "Under the hood" if non-technical
  readership.
