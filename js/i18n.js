// ═══════════════════════════════════════════════════════════════════
// Lightweight i18n for Takbeer Time.
//
//   - English is inlined as the canonical fallback (always available)
//   - Other languages are fetched from /i18n/<lang>.json on demand
//   - Auto-detects from localStorage > navigator.language > English
//   - DOM substitution via [data-i18n], [data-i18n-placeholder],
//     [data-i18n-aria-label], [data-i18n-title]
//   - Set lang+dir on <html> so CSS can target [dir="rtl"]
//   - Code can call i18n.t(key, params) for runtime strings (toasts etc.)
// ═══════════════════════════════════════════════════════════════════

window.i18n = (() => {
  // Whitelist: must match a JSON file shipped under /i18n/.
  // Order = language picker order in the header.
  // Ordered roughly by Muslim-speaker population. Picker shows in this order.
  const SUPPORTED = ['en', 'ar', 'ur', 'id', 'bn', 'hi', 'tr', 'fa', 'ms', 'fr'];
  const RTL = new Set(['ar', 'ur', 'fa']);
  const STORAGE_KEY = 'jamat.lang';

  // Display labels shown in the picker (always in the target language so
  // a user who doesn't read English can still find their language).
  const LABELS = {
    en: 'English',
    ar: 'العربية',
    ur: 'اردو',
    id: 'Bahasa Indonesia',
    bn: 'বাংলা',
    hi: 'हिन्दी',
    tr: 'Türkçe',
    fa: 'فارسی',
    ms: 'Bahasa Melayu',
    fr: 'Français',
  };
  const LABELS_EN = {
    en: 'English',
    ar: 'Arabic',
    ur: 'Urdu',
    id: 'Indonesian',
    bn: 'Bengali',
    hi: 'Hindi',
    tr: 'Turkish',
    fa: 'Persian',
    ms: 'Malay',
    fr: 'French',
  };

  // Canonical English strings. Any key referenced by code or markup MUST
  // exist here — translation files only override what they cover and fall
  // back to this baseline for missing keys.
  const EN = {
    'app.title': 'Takbeer Time',
    'app.pageTitle': 'Takbeer Time — Masjid Jamat & Iqamah Times Near You',
    'app.pageDescription': 'Find real masjid jamat, jamaat, and iqamah times near you. Follow trusted timekeepers, get prayer reminders before Fajr, Jummah, and Isha, and never miss the first takbeer.',
    'auth.signIn': 'Sign in',
    'auth.signOut': 'Sign out',
    'share.button': 'Share App on WhatsApp',
    'share.aria': 'Share Takbeer Time with someone',
    'share.title': 'Takbeer Time',
    'share.message': 'Assalamu alaikum, I use Takbeer Time to find exact jamaat and Jummah times near masjids.\nWebsite: http://takbeertime.com\nInstall the app: https://play.google.com/store/apps/details?id=com.takbeertime.android',
    'lang.label': 'Language',
    'lang.aria': 'Choose language',
    'lang.eyebrow': 'Language',
    'lang.choose': 'Choose your language',
    'account.eyebrow': 'Account',
    'account.title': 'Signed in',
    'account.openAria': 'Open account menu',
    'account.follower': 'follower',
    'account.followers': 'followers',

    'hero.kicker': 'A crowd-sourced jamat times directory',
    'hero.headlineHtml': 'Never miss the first <em>takbeer</em>.',
    'hero.subhead': 'Find the exact jamat time at any masjid near you. Be in line before the imam says Allahu Akbar.',

    'next.eyebrow': 'Your default masjid',
    'next.eyebrowNearest': 'Showing nearest masjid',
    'next.at': 'at',
    'next.reminders': 'Reminders',
    'next.bell': 'Remind me',
    'next.bellCount': '{n} reminders',
    'next.bellOpenAria': 'Open reminder settings',
    'next.flipAria': 'Toggle all reminders on or off',
    'next.viewKeepers': 'See and choose time keepers',
    'next.openKeepersAria': 'See time keepers and choose whose timings to use',
    'nav.navigate': 'Navigate to Masjid',
    'nav.navigateTo': 'Open directions to {name} in Google Maps',
    'nav.unavailable': 'Location is unavailable for this masjid.',
    'card.beFirst': 'Be the first to submit times',
    'card.closed': 'Permanently closed masjid',
    'card.closedVoting': 'Keeper voting stays open in case the community needs to correct this.',
    'card.makeDefault': 'Set as default',
    'card.isDefault': '✓ Default',
    'toast.sessionExpired': 'Your session expired. Please sign in again.',
    'next.refresh': 'Refresh times',
    'next.refreshAria': 'Pull the latest jamat times from the server',
    'next.refreshOk': 'Times updated.',
    'next.refreshOffline': "Offline — couldn't reach the server.",
    'next.refreshFail': "Couldn't refresh: {err}",
    'mosque.unnamed': 'Unnamed masjid',
    'map.popupOpen': 'Open details →',
    'next.empty': 'No masjid selected yet',
    'next.emptyHint': 'Tap a masjid below and choose “Make this my default”.',
    'next.emptyAnonName': 'Find a masjid nearby',
    'next.emptyAnonHint': 'Tap “Find masjids near me” below to see your local options.',
    'next.findNearby': 'Find nearby masjid',
    'next.byKeeper': 'Times by',
    'next.youFollow': "Using this time keeper's timings. Tap to choose another.",
    'next.topRated': 'Using the highest-rated time keeper by default. Tap to choose another.',
    'next.allKeepers': 'Time keepers',
    'next.manageKeepers': 'Choose time keeper',
    'next.currentKeeper': 'current',
    'next.topRatedShort': 'top rated',
    'next.noFollowers': 'No followers yet',
    'next.oneFollower': '1 follower',
    'next.manyFollowers': '{n} followers',
    'next.label': 'Next takbeer',
    'next.in': 'in',
    'next.unitH': 'hr',
    'next.unitM': 'min',
    'next.unitS': 'sec',
    'next.allTimes': 'All takbeer times',
    'next.allTimesToday': 'All takbeer times · today',
    'next.colJamat': 'Jamat',
    'next.colStarts': 'Starts',
    'next.colEnds': 'Ends',
    'next.timesCaption': '<strong>Jamat</strong> = announced congregation time · Starts/Ends = sun-position window for this masjid.',
    'next.tag': 'Next',
    'next.prayersWord': 'prayers',
    'next.switch': 'Switch',
    'next.noTimes': 'No timings recorded yet — be the first to submit.',
    'contributors.empty': 'No timings recorded yet.',
    'dist.meters': '{n} m away',
    'dist.km': '{n} km away',
    'nav.go': 'Go',

    'reminders.line1Html': 'Ring me before each jamat. Set <strong>0</strong> to skip a prayer.',
    'reminders.fridayHintHtml': '<em>Jummah replaces Dhuhr on Fridays — set both, the right one fires for the day.</em>',
    'reminders.minBefore': 'min before',
    'reminders.minBeforeFri': 'min before · Fri only',
    'reminders.save': 'Save',
    'reminders.test': 'Test ring',
    'reminders.off': 'Turn all off',
    'reminders.toggleAria': 'Enable {prayer} reminder',
    'reminders.notifTitle': '{prayer} at {mosque}',
    'reminders.notifBody': 'Jamat in {n} min (at {time}). Time to head out.',

    'prayer.fajr': 'Fajr',
    'prayer.dhuhr': 'Dhuhr',
    'prayer.asr': 'Asr',
    'prayer.maghrib': 'Maghrib',
    'prayer.isha': 'Isha',
    'prayer.jummah': 'Jummah',

    'qaza.pill': 'Qaza Namaz Tracker',

    'add.useLocation': 'Use my location',

    'dars.pill': 'Dars',
    'dars.eyebrow': 'Islamic lessons',
    'dars.title': 'Dars',
    'dars.subtitle': 'Create a study circle, invite people, schedule lessons and remind everyone.',
    'dars.back': 'Groups',

    'quick.locate': 'Find masjids near me',
    'quick.openMap': 'Open map',

    'appDownload.kicker': 'Takbeer Time mobile app',
    'appDownload.title': 'Take your local jamat times with you.',
    'appDownload.body': 'Download the Android app to find nearby masjids, follow trusted time keepers, and set prayer reminders that ring even when the app is closed.',
    'appDownload.pointMap': 'Map and list views for nearby masjids',
    'appDownload.pointReminders': 'Native reminders before each jamat',
    'appDownload.pointCommunity': 'Crowd-sourced updates from local time keepers',
    'appDownload.play': 'Get it on Google Play',
    'appDownload.playAria': 'Download Takbeer Time from Google Play',
    'appDownload.watch': 'Watch the app demo',
    'appDownload.shotHome': 'Home',
    'appDownload.shotTimes': 'Times',
    'appDownload.shotReminders': 'Reminders',
    'appDownload.shotMap': 'Map',
    'appDownload.shotSun': 'Salah',
    'appDownload.shotDirectory': 'Directory',

    'intent.kicker': 'Built for real masjid jamat times',
    'intent.title': 'Jamat times, iqamah times, and masjid updates in one place.',
    'intent.body': 'Most prayer times, salah, and namaz apps show when the prayer window begins. Takbeer Time is for the moment your local masjid actually starts jamaat: Fajr, Dhuhr, Asr, Maghrib, Isha, and Jummah. Search nearby masjids, follow a trusted timekeeper, and keep your family on time for the first takbeer.',
    'intent.worshippersTitle': 'For worshippers',
    'intent.worshippersBody': 'Find “jamat times near me,” check the next iqamah at your default masjid, and set reminders before jamaat.',
    'intent.timekeepersTitle': 'For timekeepers',
    'intent.timekeepersBody': 'Publish accurate masjid prayer times, receive suggested corrections, and let followers know when timings change.',
    'intent.developersTitle': 'For masjid websites',
    'intent.developersBody': 'Use the open API to show crowd-sourced jamaat and Jummah times on your own site or community display.',

    'recent.title': 'Recently added',
    'recent.sub': 'Fresh contributions from the directory',

    'dir.tabBrowse': 'Browse',
    'dir.tabFavorites': 'Favorites',
    'dir.searchPh': 'Filter by name, area, or city…',
    'dir.empty': 'Nothing to show here.',
    'dir.emptyLocate': 'Find masjids near you →',

    'map.title': 'Masjids near you',
    'map.addBtn': 'Add a masjid',
    'map.addTitle': 'Add a masjid to the directory',
    'map.closeAria': 'Close map',
    'map.addingAt': 'Adding a masjid at',
    'map.tapHint': 'Tap the map where the masjid is located.',
    'map.cancel': 'cancel',

    'add.name': 'Name',
    'add.namePh': 'e.g. Masjid Al-Falah',
    'add.city': 'City',
    'add.cityPh': 'e.g. Lahore',
    'add.country': 'Country',
    'add.countryPh': 'e.g. Pakistan',
    'add.address': 'Address',
    'add.addressPh': 'optional — e.g. Block 4, Garden Town',
    'add.submit': 'Add masjid',
    'add.cancel': 'Cancel',

    'drawer.closeAria': 'Close',
    'drawer.today': "Today's jamat",
    'drawer.byKeeper': 'Times by',
    'keeper.switch': 'Switch',
    'drawer.empty': 'No jamat times recorded for this masjid yet.',
    'drawer.emptyLead': 'Be the first to add jamat times here.',
    'drawer.emptySub': 'Earn ajar for every prayer prayed using your timings.',
    'drawer.beFirst': '+ Submit jamat times',
    'drawer.jummaTitle': 'Only know Jummah? Start there.',
    'drawer.jummaSub': 'It rarely changes - most-searched by travellers. Easy ajar every week.',
    'drawer.jummaCta': '+ Add',
    'drawer.statusCommunity': 'Community masjid',
    'drawer.statusDefault': 'Your default',
    'drawer.statusMasjid': 'Masjid',
    'drawer.distanceUnknown': 'nearby',
    'drawer.distanceVeryClose': 'right here',
    'drawer.renameAria': 'Name this masjid',
    'drawer.defaultActive': '✓ Your default masjid',
    'drawer.keepers': 'Time keepers',
    'drawer.keepersHint': "Each card is one contributor's latest timing record for this masjid. Current powers today's table. Top rated uses votes, recency, verification, and contribution history. Follow a keeper to use their times for reminders; Suggest update sends them a correction. Maghrib is not shown here because Takbeer Time calculates it from sunset plus the masjid offset.",
    'drawer.keepersGuideTitle': 'Default: highest-rated time keeper',
    'drawer.keepersGuideBody': "Your app uses the default keeper's timings for this masjid. A masjid can have several time keepers; to use someone else's provided timings, scroll down and tap \"Use this time keeper's timings\" on that card.",
    'drawer.keepersGuideRating': "Ratings use votes, recent updates, verification, contribution history, and follower trust. Followers show how many people use that keeper's timings.",
    'drawer.amenities': 'Amenities',
    'drawer.favSave': 'Save to favorites',
    'drawer.favSaved': 'Saved',
    'drawer.makeDefault': 'Make this my default',
    'drawer.submitUpdate': 'Submit a timing update',
    'drawer.submitTimes': 'Submit Jamat times',
    'drawer.closedForever': 'This masjid has closed forever',
    'drawer.recent': 'Recent submissions',
    'drawer.loading': 'Loading…',
    'drawer.noContrib': 'No submissions yet.',

    'submit.title': 'Submit a timing update',
    'submit.titleNew': 'Submit Jamat times',
    'submit.titleUpdate': 'Submit a timing update',
    'submit.note': 'Maghrib follows local sunset — pick the takbeer offset. Other times in 24-hour · HH:mm',
    'submit.noteNew': 'Leave unknown times blank. If you know Jummah, submit it - travellers are often looking for Jummah times nearby.',
    'submit.noteUpdate': 'Maghrib follows local sunset — pick the takbeer offset. Other times in 24-hour · HH:mm',
    'submit.maghribLabel': 'Maghrib offset',
    'submit.offsetAt': 'at sunset',
    'submit.offsetPlus': '+{n} min',
    'submit.notes': 'Notes (optional)',
    'submit.notesPh': 'e.g. winter schedule, board outside main entrance',
    'submit.send': 'Submit',
    'submit.cancel': 'Cancel',

    'keepers.bannerBody1': 'Your app uses the',
    'keepers.bannerBody2': 'highest-rated keeper',
    'keepers.bannerBody3': 'by default. Switch by tapping',
    'keepers.bannerBody4': 'on any card.',
    'keepers.useThese': 'Use these times',
    'keepers.updateTimes': 'Update times',
    'keepers.currentlyUsing': '✓ Currently using',
    'keepers.updated': 'Updated',
    'keepers.voteUp': 'Mark this keeper as helpful',
    'keepers.voteDown': 'Mark this keeper as unhelpful',
    'keepers.stopBeingKeeper': 'Stop being time keeper here',
    'keepers.suggestCorrection': 'Suggest a correction',
    'keepers.become': 'Become a time keeper here',

    'amenities.title': 'Masjid details',
    'amenities.eyebrow': 'community-rated',
    'amenities.rate': 'Rate this masjid',
    'amenities.noRatings': 'Not rated yet',
    'amenities.size': 'Size',
    'amenities.sizeMeta': 'capacity & space',
    'amenities.wudu': 'Wudu area',
    'amenities.wuduMeta': 'cleanliness & flow',
    'amenities.washrooms': 'Washrooms',
    'amenities.washroomsMeta': 'cleanliness',
    'amenities.accessibility': 'Accessibility',
    'amenities.accessibilityMeta': 'ramps & seating',
    'amenities.ratingEyebrow': 'Masjid rating',
    'amenities.ratingTitle': 'Rate this masjid',
    'amenities.ratingCategory': 'Category',
    'amenities.ratingSave': 'Save rating',

    'stale.title': 'These timings look stale',
    'stale.nudgePrefix': 'Nudge',
    'stale.nudgeSuffix': 'to refresh them — or submit your own.',
    'stale.cta': 'Nudge',
    'nudge.eyebrow': 'Suggest an update',
    'nudge.toPrefix': 'To',
    'nudge.title': 'Suggest the right times',
    'nudge.lede': 'Tap any prayer to propose a new time. Leave them as-is to just send a heads-up.',
    'nudge.changesProposed': 'changes proposed',
    'nudge.willSee': 'will see the diff',
    'nudge.becomeTitle': 'I want to become a time keeper · earn ajar',
    'nudge.becomeSub': 'Submit your own timings — every prayer prayed earns ajar for you.',
    'nudge.send': 'Send nudge',
    'nudge.cancel': 'Cancel',
    'nudge.sentBody': '{name} will be notified.',
    'nudge.timeEyebrow': 'Edit time',
    'nudge.currentTime': 'Current',
    'nudge.newTime': 'New time',
    'nudge.applyTime': 'Apply',
    'nudge.clearTime': 'Clear',

    'sun.title': 'Salah by sun position',
    'sun.fiqh': 'Fiqh',
    'sun.fiqh.hanafi': 'Hanafi',
    'sun.fiqh.shafi': "Shafi'i",
    'sun.fiqh.maliki': 'Maliki',
    'sun.fiqh.hanbali': 'Hanbali',
    'sun.fiqh.jafari': 'Jafari (Shia)',
    'sun.fiqh.isna': 'ISNA (N. America)',
    'sun.fiqh.egypt': 'Egyptian Authority',
    'sun.fiqh.ummalqura': 'Umm al-Qura',
    'sun.locate': 'Use my location',
    'sun.locHint': "Computed from your phone's GPS location.",
    'sun.coordsHint': 'For your location · {lat}, {lng}',
    'sun.sunrise': 'Sunrise',

    'inbox.bannerOne': '1 timing suggestion is waiting for your review',
    'inbox.bannerMany': '{n} timing suggestions are waiting for your review',
    'inbox.review': 'Review',
    'inbox.title': 'Suggested timing updates',
    'inbox.body': 'Users have suggested new times for masjids you keep. Accept to update your record (everyone following you will see the new times) or decline.',
    'inbox.from': 'from',
    'inbox.at': 'at',
    'inbox.accept': 'Accept',
    'inbox.decline': 'Decline',
    'inbox.empty': 'Inbox is empty.',
    'inbox.alertsTitle': 'Suggestion alerts are off',
    'inbox.alertsBody': 'Enable alerts on this phone so timing requests show as notifications, even when Takbeer Time is closed.',
    'inbox.alertsDeniedTitle': 'Notifications are blocked',
    'inbox.alertsDeniedBody': 'Open Android settings and allow notifications so keeper timing requests can reach this phone.',
    'inbox.alertsEnable': 'Enable alerts',
    'inbox.alertsSettings': 'Open settings',
    'inbox.alertsEnabledToast': 'Suggestion alerts enabled',
    'inbox.alertsQueuedToast': 'Alerts will turn on after notification permission is granted',
    'inbox.alertsDeniedToast': 'Notifications are blocked. Enable them in Android settings.',
    'inbox.alertsSettingsHint': 'Open Android Settings → Apps → Takbeer Time → Notifications to enable alerts.',
    'inbox.acceptedToast': 'Accepted — your record now uses these times',
    'inbox.declinedToast': 'Declined',

    'keeperIntro.eyebrow': 'Time keeper ratings',
    'keeperIntro.title': 'One masjid can have several time keepers.',
    'keeperIntro.body': 'Takbeer Time chooses the highest-rated time keeper by default, so the app starts with the timings most likely to be trusted.',
    'keeperIntro.rating': 'Rating uses votes, fresh updates, verification, contribution history, and keeper trust.',
    'keeperIntro.followers': "Followers show how many people use that keeper's timings.",
    'keeperIntro.choose': 'To use someone else\'s timings, open a masjid, scroll to Time keepers, and tap "Use this time keeper\'s timings."',
    'keeperIntro.ok': 'I understand',

    'keeper.useTimings': "Use this time keeper's timings",
    'keeper.stopUsingTimings': "Stop using this time keeper's timings",
    'keeper.sourcePreferred': 'You are using timings provided by this time keeper',
    'keeper.sourceDefault': 'Default highest-rated time keeper - these timings are used now',
    'keeper.sourceCurrent': 'Current masjid schedule - these timings are used now',
    'keeper.sourceVerifiedHistory': 'Verified previous schedule from this time keeper',
    'keeper.sourceScheduleHistory': 'Previous schedule from this time keeper',
    'keeper.sourceSubmission': 'Timing submission from this time keeper',
    'keeper.selfUpdate': 'Update the timings I provide',
    'keeper.withdraw': 'Stop being time keeper for this masjid',
    'keeper.withdrawConfirm': 'This will remove your timings from this masjid and people will no longer be able to follow you here. Continue?',

    'suggest.title': 'Suggest a timing update',
    'suggest.target': 'To {name}',
    'suggest.notes': 'Note to the keeper (optional)',
    'suggest.notesPh': 'e.g. Ramadan schedule starts tomorrow',
    'suggest.send': 'Send suggestion',
    'suggest.button': 'Suggest a correction to this keeper',
    'suggest.toastSent': 'Suggestion sent to {name}',
    'suggest.toastFail': 'Could not send: {err}',

    'login.title': 'Sign in',
    'login.body': "Sign in with Google, or with email and password. We'll create the account if it doesn't exist.",
    'login.emailPh': 'you@example.com',
    'login.passwordPh': 'Password',
    'login.passwordHint': '8+ characters. Email-only sign-in is available in local development only.',
    'login.passwordHintProd': 'Use your password, or continue with Google if available.',
    'login.passwordRequired': 'Enter your password to sign in.',
    'login.continue': 'Continue',
    'login.google': 'Continue with Google',
    'login.or': 'or with email',

    'footer.noAds': 'No ads. Ever.',
    'footer.sadqaArabic': 'صدقة في سبيل الله',
    'footer.sadqaTrans': 'This initiative is sadqa fe sabilillah.',
    'footer.sadqaJariaHtml': '<strong>This is sadqa jaria.</strong> <a href="https://takbeertime.com/api-docs.html" target="_blank" rel="noopener">The API</a> is open — call it from your own app, your masjid\'s website, anywhere a jamat time is needed. One shared database, kept by volunteer timekeepers — please use the API rather than copy the data, so their work reaches everyone. There\'s an angel out there counting every API hit. Not us.',
    'footer.colophon': 'Built for the ummah · Open source',
    'footer.apiDocs': 'API for developers',

    'toast.signedIn': 'Welcome, {name}',
    'toast.signedOut': 'Signed out',
    'toast.submissionReceived': 'Submission received — thank you',
    'toast.atLeastOne': 'Enter at least one timing',
    'toast.favSaved': 'Saved {name}',
    'toast.favRemoved': 'Removed from favorites',
    'toast.defaultSet': 'Set as your default',
    'toast.locating': 'Locating…',
    'toast.locateFail': "Couldn't find your location. Check browser permissions.",
    'toast.submitFail': 'Submission failed: {err}',
    'toast.favFail': 'Favorite failed: {err}',
  };

  let current = 'en';
  let strings = EN;

  function detect() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
    const nav = (navigator.language || 'en').toLowerCase();
    const short = nav.split('-')[0];
    if (SUPPORTED.includes(short)) return short;
    return 'en';
  }

  async function load(lang) {
    if (lang === 'en') {
      strings = EN;
      current = 'en';
    } else {
      try {
        const res = await fetch(`i18n/${lang}.json?v=21`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        // Layer the fetched strings over the EN baseline so untranslated
        // keys still render in English instead of showing the raw key.
        strings = { ...EN, ...j };
        current = lang;
      } catch (e) {
        console.warn(`i18n: failed to load ${lang}, falling back to en`, e);
        strings = EN;
        current = 'en';
      }
    }
    document.documentElement.lang = current;
    document.documentElement.dir = RTL.has(current) ? 'rtl' : 'ltr';
  }

  function t(key, params) {
    const v = strings[key] ?? EN[key] ?? key;
    if (!params) return v;
    return v.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? params[k] : `{${k}}`));
  }

  function apply(root) {
    const r = root || document;
    r.querySelectorAll('[data-i18n]').forEach(el => {
      const raw = el.getAttribute('data-i18n');
      // `key:html` lets a few strings carry inline markup (<em>, <strong>).
      if (raw.endsWith(':html')) {
        el.innerHTML = t(raw.slice(0, -5));
      } else {
        el.textContent = t(raw);
      }
    });
    r.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    r.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    r.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    // Page title comes from the same key as the meta-title above the fold.
    document.title = t('app.pageTitle');
    const description = t('app.pageDescription');
    [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ].forEach(selector => {
      const meta = document.querySelector(selector);
      if (meta) meta.setAttribute('content', description);
    });
  }

  async function set(lang) {
    if (!SUPPORTED.includes(lang)) lang = 'en';
    await load(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    apply();
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang } }));
  }

  async function init() {
    await load(detect());
    apply();
  }

  return {
    init, set, t, apply,
    current: () => current,
    supported: () => SUPPORTED.slice(),
    label: (l) => LABELS[l] || l,
    labelEn: (l) => LABELS_EN[l] || l,
    isRTL: () => RTL.has(current),
    isRTLCode: (l) => RTL.has(l),
  };
})();
