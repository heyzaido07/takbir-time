# Data Safety form — answers to enter in Play Console

This is the single most-rejected section. Answers below match `privacy.html`.

## Data collection summary

- **Does your app collect or share any of the required user data types?** Yes.
- **Is all of the user data collected by your app encrypted in transit?** Yes (HTTPS, TLS 1.2+).
- **Do you provide a way for users to request that their data is deleted?** Yes — in-app and via `https://takbeertime.com/delete-account.html`.

## Data types

| Data type | Collected? | Shared? | Purpose | Required? |
|---|---|---|---|---|
| Personal info — Email | Yes | No | Account management | Required for sign-in |
| Personal info — Name | Yes (optional) | No | Account management; attribution of submissions | Optional |
| Personal info — User IDs (Firebase UID) | Yes | No | Account management | Optional (only Google sign-ins) |
| Personal info — Other (phone) | Optional, present in schema, currently unused | No | (None active) | Optional |
| Financial info | No | — | — | — |
| Health & fitness | No | — | — | — |
| Messages | No | — | — | — |
| Photos & videos | No | — | — | — |
| Audio files | No | — | — | — |
| Files & docs | No | — | — | — |
| Calendar | No | — | — | — |
| Contacts | No | — | — | — |
| App activity — In-app actions (favorites, default mosque, reminder prefs, preferred keepers) | Yes | No | App functionality | Optional |
| App activity — Other user-generated content (submitted timings, reviews, suggestions, mosque records) | Yes | Yes (publicly via API) | App functionality + community directory | Optional |
| App info & performance — Crash logs | DECISION NEEDED — Sentry referenced in env vars but currently disabled. If enabled in production, declare this row as Yes. | — | Crash diagnostics | Optional |
| App info & performance — Diagnostics | No | — | — | — |
| App info & performance — Other | No | — | — | — |
| Device / other IDs (FCM token managed by Google's SDK) | Yes (collected by FCM, not stored on our backend) | Shared with Google for push delivery | Push notifications | Optional |
| Location — Approximate location | Yes (in-memory only) | No | App functionality (find mosques near user) | Optional |
| Location — Precise location | Yes (in-memory only — used to compute sun-position prayer times locally) | No | App functionality | Optional |
| Web browsing | No | — | — | — |
| Audio | No | — | — | — |

## Security practices

- **Data is encrypted in transit:** Yes (TLS).
- **You can request that data be deleted:** Yes (in-app + web form).
- **Committed to follow Play Families Policy if applicable:** Not applicable — app not targeting families/children-under-13 audience.
- **App was independently security-reviewed:** No (declare honestly).
