# Permissions audit — `mobile/android/app/src/main/AndroidManifest.xml`

| Permission | Justification | Notes |
|---|---|---|
| `INTERNET` | API calls, map tiles, Firebase | Required, no prominent disclosure needed. |
| `ACCESS_COARSE_LOCATION` | "Find mosques near me" | Disclosed in privacy + on-screen permission prompt. |
| `ACCESS_FINE_LOCATION` | Sun-position prayer-time calculation | Disclosed in privacy + on-screen permission prompt. |
| `POST_NOTIFICATIONS` | Prayer reminders + suggestion pushes | Required on Android 13+; user-prompted at runtime. |
| `SCHEDULE_EXACT_ALARM` | Fire prayer reminders at the exact minute | User-prompted via the OS "Alarms & reminders" toggle. **Note:** we deliberately do NOT declare `USE_EXACT_ALARM` — Play policy (May 2024) restricts that one to alarm/clock/calendar/timer apps. |
| `RECEIVE_BOOT_COMPLETED` | Re-arm prayer reminders after device reboot | Standard for any reminders app. |
| `VIBRATE` | Reminder + push haptic | Trivial. |

**Verdict:** all declared permissions are justified by features that are actually wired up. Nothing to remove.

## Location-permission justification (Play Console)

> "App functionality — Find masjids near the user; compute sun-position prayer times. We never store user location on our servers."
