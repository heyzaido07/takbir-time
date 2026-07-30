# UI/UX pass 1 — 2026-05-01

Device: RFCX308Z3NB · Capacitor debug build (`com.takbeertime.app`).

| File | Item | What changed |
|---|---|---|
| `01-home-prettified-keeper.png` | 1 | "Times by **Junaid Qazi Veemed**" — prettified from email username `junaid.qazi.veemed` |
| `02-drawer-dim-past-prayers.png` | 2 | Drawer prayer list: past prayers (Dhuhr/Asr/Isha/Jummah) are dimmed instead of struck through. Strikethrough was reading as "cancelled". |
| `03-signin-with-password.png` | 5 | Sign-in modal now has a password field below email. "No password mode" footnote removed. Email-only fallback still works for existing dev-auth users. (Captured while signed in — modal preview in repo only.) |
| `04-reminder-panel-next-fire.png` | 6 | Reminder panel header: "Next reminder: **Fajr tomorrow at 4:50 am** · rings at 04:40 (10 min before)". Two-day search so a late-night open shows tomorrow's first prayer instead of nothing. |
| `05-directory-be-the-first.png` | 4 | Directory entries with no schedule now read "Be the first to submit times" in muted brand green (lowercase, no warning amber). Reframes empty state as an invitation. |

Item 7 (haptic tap on PTR threshold) and Item 8 (hero loading skeleton) don't have dedicated captures — both are momentary visual feedback that's hard to screenshot reliably. Behaviour:

- **Item 7**: pull-to-refresh now fires `navigator.vibrate(15)` when the drag crosses the 70px commit threshold (tactile confirmation). Wired in `js/app.js wirePullToRefresh`.
- **Item 8**: `.next-card.is-loading` class adds a moving-gradient shimmer over the hero card on cold start. `renderHero()` removes the class on first paint. CSS in `css/jamat.css` `@keyframes heroSkeletonSweep`.
