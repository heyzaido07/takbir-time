# Screenshot tour — 2026-05-01

Device: Samsung phone (`RFCX308Z3NB`), 1080×2316, density 450
App: `com.takbeertime.app` (debug build, Capacitor wrapper around the canonical web `index.html`)
Captured against the local debug build that includes the codex P0/P1 server fixes plus two new UI changes:

1. **Keeper line is now tappable** with a chevron — opens the detail drawer (replaces the old "Manage" header button)
2. **Pull-to-refresh** gesture — swipe down at the top of the page to refresh times (reuses the existing refresh button handler)

| File | What it shows |
|---|---|
| `01-home-hero.png` | Default home view. Hero card with `Times by junaid.qazi.veemed ›` (the new tappable keeper line + chevron). The standalone "Manage" button is gone. |
| `02-all-times-expanded.png` | "ALL TAKBEER TIMES" disclosure expanded — Fajr 4:50 am, Dhuhr 1:30 pm visible. |
| `03-notification-permission-prompt.png` | Android system notification permission dialog — fires the first time the bell is tapped. |
| `04-detail-drawer.png` | Detail drawer opened by tapping the keeper line. Mosque metadata + "TODAY'S JAMAT" + "TIME KEEPERS" section. |
| `05-detail-time-keepers-section.png` | Scrolled inside the drawer — keeper cards with FOLLOWING badge, ratings, "Suggest update" buttons. |
| `06-detail-scrolled.png` | Further scrolled — additional keepers (`theishaq.dev`, `junaid qazi`). |
| `07-language-picker.png` | Language picker open with all 10 supported locales (English currently selected). |
| `08-arabic-rtl-home.png` | App rendered in Arabic — confirms RTL layout still works after the keeper-line refactor. The chevron sits on the visual-end side of the line in RTL. |
| `09-sign-in-modal.png` | Sign-in modal: "Continue with Google" + email field. Soft-keyboard up. |
| `10-scrolled-sun-card.png` | "SALAH BY SUN POSITION" card — Fajr/Sunrise/Dhuhr/Asr/Maghrib/Isha computed from device GPS + Hanafi fiqh. |
| `11-directory-list.png` | "Browse" tab — Faisal Mosque, Badshahi Mosque, Tooba Mosque, Wazir Khan Mosque, all marked VERIFIED, "NO TIMES YET". |
| `12-pull-to-refresh-in-flight.png` | Mid-swipe — `#ptr-indicator` visible (small loading icon at top-center). Captured while the swipe was still in progress. (Sign-in modal happened to be open in this capture; the gesture still fired correctly because touch events bubble to document.) |
| `13-pull-to-refresh-toast.png` | After a completed pull-to-refresh — "Times updated." toast confirms the refresh handler ran. |
| `14-directory-scrolled.png` | Directory scrolled further down. |
| `15-directory-with-locate-button.png` | "Find masjids near me" button visible with the directory underneath. |
| `16-map-view.png` | Map view — Leaflet rendering, default mosque pin (Mujaddiya Masjid Park Road, 180m away), "50 mosques within 25km" toast. |

## Notes from capture

- The `#next-keeper` element renders correctly as `android.widget.Button` (verified via uiautomator dump): clickable, focusable, with the visible text "Times by junaid.qazi.veemed · top-rated keeper" as its accessible name.
- Pull-to-refresh's `#ptr-indicator` is visible at the top during drag, switches to the spinner when armed, and clears after the existing refresh button's `Times updated.` toast fires.
- Browser-native pull-to-refresh (the page-reload one) is suppressed via `overscroll-behavior-y: contain` on body.
- All 10 locales updated for the renamed `next.viewKeepers` / `next.openKeepersAria` strings; Arabic RTL screenshot confirms the layout doesn't break.
