// ═══════════════════════════════════════════════════════════════════
// Jamat — Component renderers
// Pure functions: data → DOM. No event wiring (that lives in app.js).
// ═══════════════════════════════════════════════════════════════════

const PRAYER_ORDER = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'jummah'];
const DAILY_PRAYER_ORDER = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const PRAYER_LABEL = {
  fajr: 'Fajr', dhuhr: 'Dhuhr', zuhr: 'Dhuhr', asr: 'Asr',
  maghrib: 'Maghrib', isha: 'Isha', jummah: 'Jummah',
};

// Some mosques imported from OpenStreetMap have placeholder names like
// "Mosque (OSM way 1309955324)" because the OSM record had no name tag.
// Showing the raw OSM ID to users looks broken — render a friendlier
// "Unnamed mosque" instead. Translatable via i18n key 'mosque.unnamed'.
function prettifyMosqueName(name) {
  if (!name) return window.i18n?.t('mosque.unnamed') ?? 'Unnamed masjid';
  // The OSM importer writes "Mosque (OSM way 123…)" placeholders for records
  // with no name tag. Same regex still catches them — the source data uses
  // "Mosque" regardless of our UI vocabulary.
  if (/^Mosque \(OSM (way|node|relation) \d+\)$/.test(name)) {
    return window.i18n?.t('mosque.unnamed') ?? 'Unnamed masjid';
  }
  return name;
}

// Display a human-friendly version of a contributor name. The server
// stores fullName as whatever was provided at sign-up; for users who
// went through dev-auth or who filled in only an email, that's the
// email's local-part (e.g. "junaid.qazi.veemed"). Showing that raw
// reads as a system handle, not a name. We prettify only when the
// string looks like a machine handle — leave any string with spaces
// or capitals alone, since those are likely real names.
function prettifyPersonName(name) {
  if (!name || typeof name !== 'string') return name;
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  // Already humanised — has whitespace or capitals → trust the server.
  if (/\s/.test(trimmed) || /[A-Z]/.test(trimmed)) return trimmed;
  // All-lowercase, no spaces — likely an email local-part. Split on .
  // / _ / - and title-case each token. Single-token strings stay as-is
  // so handles like "junaid42" don't get touched.
  const tokens = trimmed.split(/[._\-]+/).filter(Boolean);
  if (tokens.length < 2) return trimmed;
  return tokens.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ');
}

// Treat literal "Unknown" (any casing) and empty/null as missing data.
// OSM imports sometimes write "Unknown" into city/address when the source
// record has no admin info — better to omit the field than display the
// placeholder.
function isPlaceholderField(s) {
  if (!s) return true;
  const v = s.trim().toLowerCase();
  return v === 'unknown' || v === 'testcity';
}

// Hide automated-test fixtures from user-visible lists. The e2e suite
// creates mosques like "E2E Test Masjid 1777208486603" — they leak into
// the real browse list when the test DB is the same as the dev DB.
function isTestFixture(m) {
  if (!m) return false;
  const name = (m.name || '').trim();
  if (/^E2E Test Masjid /i.test(name)) return true;
  if (/^Test Mosque /i.test(name)) return true;
  return false;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === false || v == null) {/* skip */}
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

// Format an "HH:MM" 24-hour string as locale-friendly 12-hour with am/pm.
// Returns the input unchanged if it doesn't look like a time. Lowercase
// "am"/"pm" reads more like a brand voice than the shouty "AM"/"PM".
function fmt12(t) {
  if (typeof t !== 'string') return t;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const mm = m[2];
  if (h < 0 || h > 23) return t;
  const period = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mm} ${period}`;
}

function fmtDistance(km) {
  if (km == null || isNaN(km)) return '';
  const t = (key, fallback, params) => window.i18n?.t(key, params) ?? fallback;
  if (km < 1) {
    const n = Math.round(km * 1000);
    return t('dist.meters', `${n} m away`, { n });
  }
  const n = km.toFixed(km < 10 ? 1 : 0);
  return t('dist.km', `${n} km away`, { n });
}

function parseClockTime(t) {
  if (typeof t !== 'string') return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

function normalizePrayerTime(key, t) {
  const parsed = parseClockTime(t);
  if (!parsed) return t;
  let { h } = parsed;
  const { min } = parsed;
  // Some existing rows came from 12-hour-looking picker values for
  // post-noon prayers: Dhuhr 01:30, Asr 05:30, Isha 09:00. Lift only
  // plausible afternoon/evening prayers so Fajr and 11:xx Jummah stay valid.
  const shouldLiftToPm =
    ((key === 'dhuhr' || key === 'zuhr' || key === 'jummah') && h >= 1 && h <= 4) ||
    (key === 'asr' && h >= 1 && h <= 7) ||
    (key === 'maghrib' && h >= 4 && h <= 9) ||
    (key === 'isha' && h >= 5 && h <= 11);
  if (shouldLiftToPm) h += 12;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function normalizeSubmittedPrayerTime(key, t) {
  const parsed = parseClockTime(t);
  if (!parsed) return t;
  let { h } = parsed;
  const { min } = parsed;
  if (key !== 'fajr' && h < 12) h += 12;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function defaultSubmittedPrayerTime(key) {
  return ({
    fajr: '05:00',
    dhuhr: '13:00',
    zuhr: '13:00',
    asr: '17:00',
    isha: '20:00',
    jummah: '13:00',
  })[key] || '';
}

function timingForPrayer(timings, key) {
  if (!timings) return undefined;
  const raw = timings[key === 'dhuhr' ? 'zuhr' : key] || timings[key];
  return normalizePrayerTime(key, Array.isArray(raw) ? raw[0] : raw);
}

function hasCoordinates(m) {
  const lat = Number(m?.coordinates?.lat ?? m?.latitude);
  const lng = Number(m?.coordinates?.lng ?? m?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function routeIcon(width = 14, height = 14) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M12 2 4 21l8-4 8 4-8-19Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 2v15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';
  return svg;
}

function timingsFromMosque(m) {
  // Prefer the effective schedule (active keeper's latest submission,
  // including the user's own update when they're a keeper) over the
  // master defaultJamaatTimings. Without this, the hero and the drawer
  // can drift apart: a fresh submission lands in effectiveTimings first,
  // and a hero that only watched defaultJamaatTimings would keep showing
  // the previous schedule until the master record caught up.
  //
  // Merge effective ON TOP of default: if effectiveTimings only carries
  // the prayer the keeper just updated (server is allowed to send a
  // partial schedule), unupdated prayers fall back to the master record
  // instead of rendering as undefined in the hero.
  let t = null;
  if (m && (m.effectiveTimings || m.defaultJamaatTimings)) {
    const fallback = m.defaultJamaatTimings || {};
    const e = m.effectiveTimings || {};
    const hasDailyTiming = ['fajr', 'dhuhr', 'zuhr', 'asr', 'isha'].some(k => e[k] || fallback[k]);
    const jummahPick = (Array.isArray(e.jummah) ? e.jummah[0] : e.jummah)
      ?? (Array.isArray(fallback.jummah) ? fallback.jummah[0] : fallback.jummah);
    t = {
      fajr:          normalizePrayerTime('fajr', e.fajr  ?? fallback.fajr),
      zuhr:          normalizePrayerTime('dhuhr', e.dhuhr ?? e.zuhr ?? fallback.zuhr ?? fallback.dhuhr),
      asr:           normalizePrayerTime('asr', e.asr   ?? fallback.asr),
      maghribOffset: e.maghribOffset ?? fallback.maghribOffset,
      hasDailyTiming,
      isha:          normalizePrayerTime('isha', e.isha  ?? fallback.isha),
      jummah:        normalizePrayerTime('jummah', jummahPick),
      // Carry coords on the timings object so multi-day consumers
      // (computeNextPrayer, reminders.schedule) can recompute Maghrib from
      // each day's astronomical sunset instead of reusing today's value.
      lat:           m?.coordinates?.lat ?? m?.latitude ?? null,
      lng:           m?.coordinates?.lng ?? m?.longitude ?? null,
    };
  }
  if (!t) return null;
  // Maghrib = today's astronomical sunset + the contributor's takbeer
  // offset (e.g. +3 min). Only show it when a keeper/default schedule
  // actually carries a Maghrib offset. A Jummah-only submission should
  // not turn into a daily Maghrib listing just because coordinates exist.
  const shouldComputeMaghrib = t.hasDailyTiming || !t.jummah;
  if (window.sun && m && shouldComputeMaghrib && Number.isFinite(Number(t.maghribOffset))) {
    const computedMaghrib = window.sun.maghribForMosque(m, undefined, Number(t.maghribOffset));
    if (computedMaghrib) {
      return { ...t, maghrib: normalizePrayerTime('maghrib', computedMaghrib) };
    }
  }
  return t;
}

function prayerOrderForDate(date, timings) {
  const isFriday = date.getDay() === 5;
  if (isFriday && timingForPrayer(timings, 'jummah')) {
    return ['fajr', 'jummah', 'asr', 'maghrib', 'isha'];
  }
  return DAILY_PRAYER_ORDER;
}

// Returns {key, label, time, minutesUntil} for the next upcoming prayer.
// Jummah is date-aware: on Friday it replaces Dhuhr when present; on other
// days it is not treated as a daily prayer. The look-ahead lets a mosque with
// only Jummah submitted still surface next Friday instead of a fake daily row.
function computeNextPrayer(timings) {
  if (!timings) return null;
  const now = new Date();
  const candidates = [];
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + dayOffset);
    for (const key of prayerOrderForDate(day, timings)) {
      let t = timingForPrayer(timings, key);
      // Maghrib tracks the sun: recompute it for *this* look-ahead day rather
      // than reusing today's sunset. Only override an already-present Maghrib
      // so a Jummah-only schedule doesn't sprout a daily Maghrib row.
      if (key === 'maghrib' && t && window.sun
          && Number.isFinite(Number(timings.maghribOffset))
          && timings.lat != null && timings.lng != null) {
        const perDay = window.sun.maghribForMosque(
          { latitude: timings.lat, longitude: timings.lng }, day, Number(timings.maghribOffset));
        if (perDay) t = perDay;
      }
      if (!t || typeof t !== 'string') continue;
      const parsed = parseClockTime(t);
      if (!parsed) continue;
      const target = new Date(day);
      target.setHours(parsed.h, parsed.min, 0, 0);
      if (target <= now) continue;
      candidates.push({
        key,
        label: PRAYER_LABEL[key],
        time: t,
        minutes: parsed.h * 60 + parsed.min,
        target,
      });
    }
  }
  if (!candidates.length) return null;
  const next = candidates.sort((a, b) => a.target - b.target)[0];
  const minutesUntil = Math.ceil((next.target - now) / 60000);
  return { ...next, minutesUntil };
}

// ───── Mosque card ─────
// `isDefault` (when truthy) renders the set-default pill in the
// confirmed-state ("✓ Default") rather than the call-to-action state.
// app.js's makeCard passes effectiveDefaultMosqueId() === m.id.
function renderCard(m, { highlightNext = true, isDefault = false } = {}) {
  const timings = timingsFromMosque(m);
  const next = highlightNext ? computeNextPrayer(timings) : null;
  const isClosed = m.status === 'closed';

  const cleanCity = isPlaceholderField(m.city) ? '' : m.city;
  const cleanAddress = isPlaceholderField(m.address) ? '' : m.address;

  // Pill that lets the user pick this masjid as their default straight
  // from the list, without first opening the detail drawer. It's a real
  // <button> nested inside the card's clickable region — app.js wires a
  // stopPropagation handler so tapping it doesn't also open the drawer.
  // The data-set-default attribute is the hook the click delegate keys
  // off, so the markup stays declarative and the JS doesn't need a
  // direct reference to each pill.
  const defaultPill = el('button', {
    class: 'card__set-default' + (isDefault ? ' is-default' : ''),
    type: 'button',
    'data-set-default': m.id,
    'aria-pressed': isDefault ? 'true' : 'false',
    'aria-label': isDefault
      ? `${prettifyMosqueName(m.name)} is your default masjid`
      : `Set ${prettifyMosqueName(m.name)} as your default masjid`,
  }, isDefault
    ? (window.i18n?.t('card.isDefault') ?? '✓ Default')
    : (window.i18n?.t('card.makeDefault') ?? 'Set as default'));

  const navigateButton = hasCoordinates(m)
    ? el('button', {
      class: 'card__navigate',
      type: 'button',
      'data-navigate': m.id,
      'aria-label': window.i18n?.t('nav.navigateTo', { name: prettifyMosqueName(m.name) })
        ?? `Open directions to ${prettifyMosqueName(m.name)} in Google Maps`,
    }, [
      routeIcon(),
      el('span', {}, window.i18n?.t('nav.navigate') ?? 'Navigate to Masjid'),
    ])
    : null;

  const metaItems = [];
  if (cleanCity) metaItems.push(el('span', {}, cleanCity));
  if (isClosed) {
    metaItems.push(el('span', { class: 'card__status-closed', title: 'Marked permanently closed by the highest-rated time keeper' }, 'permanently closed'));
  } else if (m.verified) {
    metaItems.push(el('span', { class: 'card__verified', title: 'Community-verified' }, 'verified'));
  } else {
    metaItems.push(el('span', { class: 'dot' }));
  }

  const timeItems = isClosed
    ? [
        el('span', { class: 'card__next card__next--closed' }, window.i18n?.t('card.closed') ?? 'Closed masjid'),
        el('span', { class: 'card__notimes card__notimes--closed' }, window.i18n?.t('card.closedVoting') ?? 'Keeper voting stays open'),
        m.distanceKm != null ? el('span', { class: 'card__distance' }, fmtDistance(m.distanceKm)) : null,
      ]
    : [
        next ? el('span', { class: 'card__next' }, next.label) : null,
        next
          ? el('span', { class: 'card__next-time' }, fmt12(next.time))
          : el('span', { class: 'card__notimes' }, window.i18n?.t('card.beFirst') ?? 'Be the first to submit times'),
        m.distanceKm != null
          ? el('span', { class: 'card__distance' }, fmtDistance(m.distanceKm))
          : null,
      ];

  return el('li', { class: 'card' + (isClosed ? ' is-closed' : ''), dataset: { id: m.id }, tabindex: '0', role: 'button' }, [
    el('div', { class: 'card__main' }, [
      el('h3', { class: 'card__name' }, prettifyMosqueName(m.name)),
      cleanAddress ? el('p', { class: 'card__addr' }, cleanAddress) : null,
      el('div', { class: 'card__meta' }, metaItems),
    ]),
    el('div', { class: 'card__times' }, timeItems),
    el('div', { class: 'card__actions' }, [navigateButton, defaultPill]),
  ]);
}

// ───── Detail drawer body ─────
function renderTimingsTable(timings) {
  if (!timings) {
    return el('tr', {}, el('td', {}, el('span', { class: 'contributors__empty' }, window.i18n?.t('contributors.empty') ?? 'No timings recorded yet.')));
  }
  const next = computeNextPrayer(timings);
  const todaysOrder = prayerOrderForDate(new Date(), timings);
  const order = todaysOrder.includes('jummah')
    ? todaysOrder
    : [...todaysOrder, ...(timingForPrayer(timings, 'jummah') ? ['jummah'] : [])];
  return order.map(key => {
    const t = timingForPrayer(timings, key);
    const label = (typeof window !== 'undefined' && window.i18n?.t(`prayer.${key}`)) || PRAYER_LABEL[key];
    if (!t) return null;
    const isNext = next && next.key === key;
    const isPassed = !isNext && timeBefore(key, t);
    return el('tr', {}, [
      el('td', { class: 'name' }, label),
      el('td', {
        class: 'time' + (isNext ? ' time--upcoming' : isPassed ? ' time--passed' : ''),
      }, fmt12(t)),
    ]);
  }).filter(Boolean);
}

function timeBefore(key, t) {
  const now = new Date();
  const parsed = parseClockTime(normalizePrayerTime(key, t));
  if (!parsed) return false;
  return (parsed.h * 60 + parsed.min) < (now.getHours() * 60 + now.getMinutes());
}

function renderAmenities(mosqueOrList) {
  const mosque = Array.isArray(mosqueOrList) ? { amenities: mosqueOrList } : (mosqueOrList || {});
  const legacyAmenities = Array.isArray(mosque.amenities) ? mosque.amenities : [];
  const ratings = mosque.amenityRatings || {};
  const tx = (key, fallback, params) => window.i18n?.t(key, params) ?? fallback;
  const rows = [
    { kind: 'size', label: tx('amenities.size', 'Size'), meta: tx('amenities.sizeMeta', 'capacity & space'), icon: '⌂' },
    { kind: 'wudu', label: tx('amenities.wudu', 'Wudu area'), meta: tx('amenities.wuduMeta', 'cleanliness & flow'), icon: '◌' },
    { kind: 'washrooms', label: tx('amenities.washrooms', 'Washrooms'), meta: tx('amenities.washroomsMeta', 'cleanliness'), icon: 'WC' },
    { kind: 'accessibility', label: tx('amenities.accessibility', 'Accessibility'), meta: tx('amenities.accessibilityMeta', 'ramps & seating'), icon: '♿' },
  ];

  const pretty = (s) => String(s || '').replace(/_/g, ' ');
  const legacyText = legacyAmenities.length ? legacyAmenities.map(pretty).join(' · ') : '';

  return rows.map((row) => {
    const rating = ratings[row.kind] || {};
    const avg = Number(rating.avg) || 0;
    const count = Number(rating.count) || 0;
    const score = count > 0
      ? el('p', { class: 'amenity-row__score' }, [
          el('strong', {}, avg.toFixed(1)),
          ` · ${count} ${count === 1 ? 'rating' : 'ratings'}`,
        ])
      : el('p', { class: 'amenity-row__score' }, tx('amenities.noRatings', 'Not rated yet'));
    return el('li', { class: 'amenity-row', dataset: { kind: row.kind }, tabindex: '0', role: 'button' }, [
      el('div', { class: 'amenity-row__icon', 'aria-hidden': 'true' }, row.icon),
      el('div', { class: 'amenity-row__body' }, [
        el('p', { class: 'amenity-row__label' }, row.label),
        el('p', { class: 'amenity-row__meta' }, row.kind === 'size' && legacyText ? legacyText : row.meta),
      ]),
      el('div', { class: 'amenity-row__rating' }, [
        el('span', { class: 'stars', style: `--val:${Math.max(0, Math.min(5, avg))}` }),
        score,
      ]),
    ]);
  });
}

// Convert minutes to {h, m, s} relative to a fixed prayer time
function clockParts(minutesUntil, secsRemainder = 0) {
  const totalSec = Math.max(0, minutesUntil * 60 - secsRemainder);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return { h: String(h).padStart(2, '0'), m: String(m).padStart(2, '0'), s: String(s).padStart(2, '0') };
}

function renderKeeper(keeper, { effectiveKeeperId, preferredKeeperId, topKeeperId, currentUserId, onFollow, onVote, onSuggest, onSelfUpdate, onWithdraw }) {
  const isEffective = keeper.submitterId === effectiveKeeperId;
  const isPreferred = keeper.submitterId === preferredKeeperId;
  const isTopRated = keeper.submitterId === topKeeperId;
  const isCurrentSchedule = !!keeper.activeSchedule;
  const isOwnKeeper = currentUserId && keeper.submitterId === currentUserId;
  const canVote = !!keeper.latestSubmissionId;
  const t = keeper.timings || {};
  const keeperPrayerTimes = [
    { key: 'fajr', labelKey: 'prayer.fajr', label: PRAYER_LABEL.fajr, aliases: ['fajr'] },
    { key: 'dhuhr', labelKey: 'prayer.dhuhr', label: PRAYER_LABEL.dhuhr, aliases: ['dhuhr', 'zuhr'] },
    { key: 'asr', labelKey: 'prayer.asr', label: PRAYER_LABEL.asr, aliases: ['asr'] },
    { key: 'maghrib', labelKey: 'prayer.maghrib', label: PRAYER_LABEL.maghrib, aliases: ['maghrib'] },
    { key: 'isha', labelKey: 'prayer.isha', label: PRAYER_LABEL.isha, aliases: ['isha'] },
    { key: 'jummah', labelKey: 'prayer.jummah', label: PRAYER_LABEL.jummah, aliases: ['jummah'] },
  ];
  const timingValue = (aliases) => {
    for (const key of aliases) {
      const value = t[key];
      if (Array.isArray(value)) return value[0] || null;
      if (value != null && value !== '') return value;
    }
    return null;
  };
  const timeTiles = keeperPrayerTimes.map(prayer => {
    const raw = normalizePrayerTime(prayer.key, timingValue(prayer.aliases));
    return el('li', {
      class: 'keeper-card__time' + (!raw ? ' keeper-card__time--missing' : ''),
      title: raw ? `${prayer.label}: ${fmt12(raw)}` : `${prayer.label}: not set`,
    }, [
      el('span', {}, window.i18n?.t(prayer.labelKey) ?? prayer.label),
      el('strong', {}, raw ? fmt12(raw) : 'Not set'),
    ]);
  });

  const verified = keeper.verifiedContributor
    ? el('span', { class: 'verified' }, '✓ verified')
    : null;
  const followerCount = Number(keeper.followerCount) || 0;
  const followerLabel = window.i18n
    ? window.i18n.t(followerCount === 1 ? 'next.oneFollower' : (followerCount === 0 ? 'next.noFollowers' : 'next.manyFollowers'), { n: followerCount })
    : (followerCount === 1 ? '1 follower' : (followerCount === 0 ? 'No followers yet' : `${followerCount} followers`));
  const tx = (key, fallback, params) => window.i18n?.t(key, params) ?? fallback;
  const followLabel = isPreferred
    ? tx('keeper.stopUsingTimings', "Stop using this time keeper's timings")
    : tx('keeper.useTimings', "Use this time keeper's timings");

  const sourceLabel = isPreferred
    ? tx('keeper.sourcePreferred', 'You are using timings provided by this time keeper')
    : (isEffective && isTopRated
      ? tx('keeper.sourceDefault', 'Default highest-rated time keeper - these timings are used now')
      : (isCurrentSchedule
        ? tx('keeper.sourceCurrent', 'Current masjid schedule - these timings are used now')
        : (keeper.verifiedSchedule
          ? tx('keeper.sourceVerifiedHistory', 'Verified previous schedule from this time keeper')
          : (keeper.latestSourceType === 'prayerSchedule'
            ? tx('keeper.sourceScheduleHistory', 'Previous schedule from this time keeper')
            : tx('keeper.sourceSubmission', 'Timing submission from this time keeper')))));
  const versionLabel = `v${keeper.submissionCount || 1}`;
  const rawRating = Number(keeper.rating) || 0;
  const starRating = rawRating <= 5 ? rawRating : Math.min(5, rawRating / 4);
  const ratingLabel = `★ ${starRating.toFixed(1)}`;
  const updatedAt = keeper.updatedAt || keeper.submittedAt || keeper.latestSubmittedAt || keeper.latestSubmissionAt || keeper.activeSchedule?.updatedAt;
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : (isCurrentSchedule ? 'current schedule' : 'recent');
  const person = prettifyPersonName(keeper.submitterName) || 'Time keeper';
  const initials = person
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'TK';

  const followBtn = el('button', {
    class: isPreferred ? 'btn btn--ghost keeper-card__primary' : 'btn btn--primary keeper-card__primary',
    type: 'button',
    onclick: (e) => { e.stopPropagation(); onFollow(keeper); },
  }, isPreferred ? tx('keeper.stopUsingTimings', 'Stop using these timings') : tx('keepers.useThese', 'Use these times'));

  // Up/down vote buttons. The submission backend rejects votes on your own
  // submission with a 400; we let that through and surface as a toast.
  // Thumbs-up / thumbs-down icons (currentColor inherits the button's color).
  const thumbSvg = (down) => {
    const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrap.setAttribute('viewBox', '0 0 24 24');
    wrap.setAttribute('width', '14');
    wrap.setAttribute('height', '14');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.display = 'block';
    if (down) wrap.style.transform = 'rotate(180deg) scaleX(-1)';
    wrap.innerHTML = '<path d="M7 11h2v9H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2zm5 9h6.6a2 2 0 0 0 1.96-1.6l1.2-6A2 2 0 0 0 19.8 10H15V6a2 2 0 0 0-2-2l-1 5-3 3v8z" fill="currentColor"/>';
    return wrap;
  };
  const upBtn = canVote ? el('button', {
    class: 'keeper-card__vote keeper-card__vote--up',
    type: 'button',
    'aria-label': tx('keepers.voteUp', `Mark ${person} as helpful`),
    title: tx('keepers.voteUp', `Mark ${person} as helpful`),
    dataset: { type: 'upvote' },
    onclick: (e) => { e.stopPropagation(); onVote(keeper, 'upvote'); },
  }, thumbSvg(false)) : null;
  const downBtn = canVote ? el('button', {
    class: 'keeper-card__vote keeper-card__vote--down',
    type: 'button',
    'aria-label': tx('keepers.voteDown', `Mark ${person} as unhelpful`),
    title: tx('keepers.voteDown', `Mark ${person} as unhelpful`),
    dataset: { type: 'downvote' },
    onclick: (e) => { e.stopPropagation(); onVote(keeper, 'downvote'); },
  }, thumbSvg(true)) : null;

  // Plain-language action button. For your own card, say exactly what the
  // user is about to do; for another keeper, make it clear this is a
  // suggestion sent to that keeper, not an immediate edit.
  const suggestBtn = isOwnKeeper && onSelfUpdate
    ? el('button', {
        class: 'btn btn--ghost keeper-card__secondary',
        type: 'button',
        onclick: (e) => { e.stopPropagation(); onSelfUpdate(keeper); },
      }, tx('keepers.updateTimes', 'Update times'))
    : (!isOwnKeeper && onSuggest)
    ? el('button', {
        class: 'btn btn--ghost keeper-card__secondary',
        type: 'button',
        onclick: (e) => { e.stopPropagation(); onSuggest(keeper); },
      }, tx('keepers.suggestCorrection', 'Suggest a correction'))
    : null;
  const withdrawBtn = (isOwnKeeper && onWithdraw)
    ? el('button', {
        class: 'btn btn--ghost btn--danger keeper-card__secondary',
        type: 'button',
        onclick: (e) => { e.stopPropagation(); onWithdraw(keeper); },
      }, tx('keepers.stopBeingKeeper', 'Stop being time keeper here'))
    : null;

  return el('li', {
    class: 'keeper-card'
      + (isPreferred ? ' is-following' : '')
      + (isTopRated && !isPreferred && !isEffective ? ' is-top-rated' : ''),
    'aria-current': isEffective ? 'true' : 'false',
    dataset: { id: keeper.submitterId, submissionId: keeper.latestSubmissionId || '' },
  }, [
    isEffective ? el('span', { class: 'keeper-card__ribbon' }, tx('keepers.currentlyUsing', '✓ Currently using')) : null,
    el('header', { class: 'keeper-card__head' }, [
      el('div', { class: 'keeper-card__avatar', 'aria-hidden': 'true' }, initials),
      el('div', { class: 'keeper-card__id' }, [
        el('p', { class: 'keeper-card__name' }, person),
        el('p', { class: 'keeper-card__meta', 'aria-label': `${ratingLabel}, ${followerLabel}` }, [
          el('span', { class: 'keeper-card__rating', title: `Composite score: ${rawRating.toFixed(2)}` }, ratingLabel),
          el('span', { class: 'keeper-card__sep', 'aria-hidden': 'true' }, '·'),
          el('span', {}, followerLabel),
          el('span', { class: 'keeper-card__sep', 'aria-hidden': 'true' }, '·'),
          el('span', {}, versionLabel),
          verified,
        ]),
      ]),
      canVote ? el('div', { class: 'keeper-card__votes' }, [upBtn, downBtn]) : null,
    ]),
    el('p', { class: 'keeper-card__source' }, sourceLabel),
    el('ul', { class: 'keeper-card__times' }, timeTiles),
    el('footer', { class: 'keeper-card__foot' }, [
      el('span', { class: 'keeper-card__updated' }, [
        `${tx('keepers.updated', 'Updated')} `,
        el('time', { datetime: updatedAt || '' }, updatedLabel),
      ]),
      el('div', { class: 'keeper-card__actions' }, [followBtn, suggestBtn, withdrawBtn]),
    ]),
  ]);
}

window.JAMAT_RENDER = {
  el, renderCard, renderTimingsTable, renderAmenities, renderKeeper,
  computeNextPrayer, clockParts, fmtDistance, fmt12, timingsFromMosque,
  normalizePrayerTime, normalizeSubmittedPrayerTime, defaultSubmittedPrayerTime, timingForPrayer,
  prettifyMosqueName, prettifyPersonName, isPlaceholderField, isTestFixture,
  PRAYER_LABEL, PRAYER_ORDER, prayerOrderForDate,
};
