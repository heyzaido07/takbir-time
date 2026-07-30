# Material 3 design pass — 2026-05-02

Device: RFCX308Z3NB. Goal: drop in known Material 3 component patterns
(buttons, text fields, chips, switches) onto the existing brass-and-green
palette without a framework dependency. Hand-rolled the M3 spec on top
of new design tokens at the top of `css/jamat.css`.

## What landed

**Design tokens** (`:root` in jamat.css):
- M3 colour roles mapped onto the existing palette: `--m3-primary` → green,
  `--m3-secondary` → brass, surface roles → paper variants, error → crimson.
- State-layer opacities: 8% hover / 12% focus / 16% press.
- Shape tokens: corner-xs/sm/md/lg/xl/full with M3-spec values (4/8/12/16/28/999px).
- Three elevation steps + four typography roles (label-large/medium, body-large/medium).

**Buttons** — every `.btn` selector upgraded in-place:
- `.btn` is now the M3 OUTLINED button (40px height, full-pill, state layer).
- `.btn--primary` is FILLED (primary container colour, elevation 1 → 2 on hover).
- `.btn--ghost` is TEXT (no border, reduced padding).
- `.btn[aria-pressed=true]` is TONAL (secondary container).
- State-layer pseudo-element fades currentColor 0% → 8/12/16% on hover/focus/press
  — same grammar across every variant.
- `.quick__btn` (Find masjids near me) upgraded to M3 EXTENDED FAB (56px, elevated).

**Chips**:
- `.card__verified` (directory): M3 small chip, primary-container colour.
- Keeper card status pills (Following / Top rated): M3 chips, primary vs
  secondary-container so they distinguish at a glance.

**Text fields**:
- Email + password (login modal): M3 OUTLINED text field — 56px height,
  primary outline thickens 1→2px on focus via inset box-shadow (no layout shift),
  proper placeholder colour.

**Hero card**:
- Keeper line ("Times by [Name] · you follow them ›") promoted to a
  Material 3 ASSIST CHIP — translucent paper container, outlined border,
  state layer. Now visually obvious as tappable.

**Reminder panel**:
- "min before" suffix dropped to label-medium typography and given a
  max-width so it wraps onto two lines instead of overflowing the row.
- Number input height aligned with the toggle (36px), forced past the
  global is-native 44px tap-target rule that was making the row uneven.

**Native bridge**:
- `nativeReminders.fireTest()` now cancels both pending and delivered
  copies of the test notification before scheduling a new one. Without
  this, repeat taps of "Test ring" updated the existing notification and
  Android applied `ONLY_ALERT_ONCE` — silent on the second tap onwards.

## Captures

| File | What it shows |
|---|---|
| `01-home-keeper-chip.png` | Hero with the keeper line as an outlined M3 assist chip. Bell + refresh perfect circles. |
| `02-panel-toggles-buttons.png` | Reminder panel — M3 toggles, "Next reminder" status box, prayer rows. |
| `03-panel-bottom-buttons.png` | Reminder panel scrolled — "Fri only" suffix on Jummah, two-line "min before" wrap, Test/Turn all off buttons as M3 outlined. |
| `04-directory-verified-chips.png` | Directory rows with M3 chip "VERIFIED" in primary-container green; "Find masjids near me" as M3 extended FAB; "Use my location" as M3 filled button. |
| `05-drawer-keeper-chips.png` | Detail drawer (capture skipped — tap missed; behaviour unchanged from earlier passes). |
| `06-drawer-time-keepers.png` | Capture caught a refresh-button tap accident; "Times updated." toast visible. |
