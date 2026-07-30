// ========================================
// ✨ LOCALSTORAGE UTILITIES
// ========================================
const storage = {
  saveFavorites(favorites) {
    localStorage.setItem('jamat_favorites', JSON.stringify(favorites));
  },

  getFavorites() {
    // Parsed at module-eval time (state.user.favoriteMosques below), so a
    // corrupted value must never throw — that would abort state construction
    // and leave the whole app blank with no recovery.
    try {
      const stored = localStorage.getItem('jamat_favorites');
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveDefaultMosque(mosqueId) {
    localStorage.setItem('jamat_default_mosque', mosqueId);
  },

  getDefaultMosque() {
    return localStorage.getItem('jamat_default_mosque');
  },

  markOnboardingComplete() {
    localStorage.setItem('jamat_onboarding_done', 'true');
  },

  hasCompletedOnboarding() {
    return localStorage.getItem('jamat_onboarding_done') === 'true';
  },

  // ✨ Auth storage
  saveAuth(user) {
    localStorage.setItem('jamat_auth', JSON.stringify(user));
  },

  getAuth() {
    try {
      const stored = localStorage.getItem('jamat_auth');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  },

  clearAuth() {
    localStorage.removeItem('jamat_auth');
  },

  qazaStorageKey(ownerKey) {
    const suffix = String(ownerKey || 'anonymous').trim().toLowerCase() || 'anonymous';
    return `jamat_qaza_records_v1:${suffix}`;
  },

  getQazaRecords(ownerKey) {
    try {
      const rows = JSON.parse(localStorage.getItem(this.qazaStorageKey(ownerKey)) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  },

  saveQazaRecords(records, ownerKey) {
    localStorage.setItem(this.qazaStorageKey(ownerKey), JSON.stringify(Array.isArray(records) ? records : []));
  },

  // Per-mosque cache. Keyed by mosque id, holds the full adapted record so
  // the hero/drawer can render instantly on next visit and so the UI never
  // blinks to empty when a later response comes back partial or fails.
  // Capped + LRU-evicted so a heavy user can't blow past the localStorage
  // quota. We only ever write entries that have timings — empty schedules
  // would defeat the whole point of the fallback.
  saveMosqueCache(mosque) {
    if (!mosque || !mosque.id) return;
    if (!mosque.defaultJamaatTimings && !mosque.effectiveTimings) return;
    const cache = this._readMosqueCache();
    cache[mosque.id] = { mosque, cachedAt: Date.now() };
    this._writeMosqueCache(cache);
  },

  // maxAgeMs (optional): when given, entries older than this are treated as
  // absent. Callers backfilling a reachable-but-blank response pass a TTL so
  // an intentionally-cleared schedule can't keep showing stale times forever.
  // The offline-fallback path passes no TTL — last-good is better than nothing
  // when the backend is unreachable.
  getMosqueCache(id, maxAgeMs) {
    if (!id) return null;
    const entry = this._readMosqueCache()[id];
    if (!entry) return null;
    if (typeof maxAgeMs === 'number') {
      if (!entry.cachedAt || (Date.now() - entry.cachedAt) > maxAgeMs) return null;
    }
    return entry.mosque || null;
  },

  _readMosqueCache() {
    try {
      return JSON.parse(localStorage.getItem('jamat_mosque_cache_v1') || '{}');
    } catch {
      return {};
    }
  },

  _writeMosqueCache(cache) {
    const MAX = 100;
    const ids = Object.keys(cache);
    if (ids.length > MAX) {
      ids.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0))
         .slice(0, ids.length - MAX)
         .forEach((id) => { delete cache[id]; });
    }
    try {
      localStorage.setItem('jamat_mosque_cache_v1', JSON.stringify(cache));
    } catch {
      // Quota exceeded — drop the oldest half and retry once.
      try {
        const remaining = Object.keys(cache);
        remaining.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0))
                 .slice(0, Math.floor(remaining.length / 2))
                 .forEach((id) => { delete cache[id]; });
        localStorage.setItem('jamat_mosque_cache_v1', JSON.stringify(cache));
      } catch {}
    }
  },
};

// ========================================
// STATE MANAGEMENT
// ========================================
const state = {
  currentView: "list",
  selectedMosqueId: null,
  userLocation: null,
  map: null,
  markers: [],
  countdownIntervalId: null,
  mosques: [
    {
      id: "m1",
      name: "Central Jamia Masjid",
      address: "Main Boulevard, Block A",
      city: "Lahore",
      country: "Pakistan",
      coordinates: { lat: 31.5204, lng: 74.3587 },
      distanceKm: 0.8,
      rating: 4.8,
      contributorCount: 142,
      lastUpdated: "2025-11-23T10:00:00Z",
      phoneNumber: "+92-42-35876543",
      amenities: ['parking', 'wudu_facilities', 'womens_section', 'wheelchair_accessible', 'library', 'ac', 'jummah_2'],
      defaultJamaatTimings: {
        fajr: "05:15",
        zuhr: "13:30",
        asr: "16:15",
        maghribOffset: 5,
        isha: "19:45",
        jummah: "13:30",
        jummah_2: "14:15"
      }
    },
    {
      id: "m2",
      name: "Masjid Bilal",
      address: "Near City Park, Block C",
      city: "Lahore",
      country: "Pakistan",
      coordinates: { lat: 31.5304, lng: 74.3487 },
      distanceKm: 2.4,
      rating: 4.5,
      contributorCount: 27,
      lastUpdated: "2025-11-22T18:30:00Z",
      phoneNumber: "+92-333-9876543",
      amenities: ['wudu_facilities', 'school', 'ac'],
      defaultJamaatTimings: {
        fajr: "05:30",
        zuhr: "13:15",
        asr: "16:00",
        maghribOffset: 5,
        isha: "19:30",
        jummah: "13:15"
      }
    },
    {
      id: "m3",
      name: "Grand Jamia Mosque",
      address: "Bahria Town",
      city: "Lahore",
      country: "Pakistan",
      coordinates: { lat: 31.3668, lng: 74.1839 },
      distanceKm: 15.2,
      rating: 4.9,
      contributorCount: 350,
      lastUpdated: "2025-11-23T08:00:00Z",
      phoneNumber: "+92-42-111-222-333",
      amenities: ['parking', 'wudu_facilities', 'womens_section', 'wheelchair_accessible', 'library', 'school', 'ac', 'jummah_2', 'jummah_3'],
      defaultJamaatTimings: {
        fajr: "05:00",
        zuhr: "13:30",
        asr: "16:15",
        maghribOffset: 5,
        isha: "20:00",
        jummah: "13:00",
        jummah_2: "13:45",
        jummah_3: "14:30"
      }
    },
    {
      id: "m4",
      name: "Faisal Mosque",
      address: "Shah Faisal Ave",
      city: "Islamabad",
      country: "Pakistan",
      coordinates: { lat: 33.7294, lng: 73.0372 },
      distanceKm: 280.5,
      rating: 5.0,
      contributorCount: 1200,
      lastUpdated: "2025-11-20T12:00:00Z",
      phoneNumber: "+92-51-9202345",
      amenities: ['parking', 'wudu_facilities', 'womens_section', 'wheelchair_accessible', 'library', 'ac'],
      defaultJamaatTimings: {
        fajr: "05:10",
        zuhr: "13:45",
        asr: "16:30",
        maghribOffset: 5,
        isha: "19:50",
        jummah: "13:30"
      }
    },
    {
      id: "m5",
      name: "Masjid-e-Nimra",
      address: "Clifton Beach Road",
      city: "Karachi",
      country: "Pakistan",
      coordinates: { lat: 24.8607, lng: 67.0011 },
      distanceKm: 1020.0,
      rating: 4.7,
      contributorCount: 85,
      lastUpdated: "2025-11-21T15:45:00Z",
      phoneNumber: "",
      amenities: ['parking', 'wudu_facilities', 'ac'],
      defaultJamaatTimings: {
        fajr: "05:45",
        zuhr: "13:30",
        asr: "16:45",
        maghribOffset: 5,
        isha: "20:15",
        jummah: "13:45"
      }
    },
    {
      id: "m6",
      name: "Local Musalla",
      address: "Street 4, Neighborhood",
      city: "Lahore",
      country: "Pakistan",
      coordinates: { lat: 31.5250, lng: 74.3500 },
      distanceKm: 0.2,
      rating: 3.8,
      contributorCount: 3,
      lastUpdated: "2025-11-10T05:00:00Z",
      phoneNumber: "",
      amenities: ['wudu_facilities'],
      defaultJamaatTimings: {
        fajr: "05:20",
        zuhr: "13:15",
        asr: "16:00",
        maghribOffset: 5,
        isha: "19:30",
        jummah: "13:15"
      }
    }
  ],
  // ✨ Community submissions for each mosque
  submissions: {
    m1: [
      {
        id: "sub1",
        userId: "user123",
        userName: "Ahmed Khan",
        userReputation: 450,
        isTopContributor: true,
        submittedAt: "2025-11-23T09:30:00Z",
        timings: { fajr: "05:15", zuhr: "13:30", asr: "16:15", maghrib: "17:20", isha: "19:45", jummah: "13:30", jummah_2: "14:15" },
        notes: "Verified from mosque board",
        verified: true,
        verifiedBy: 12,
        status: "active"
      },
      {
        id: "sub2",
        userId: "user456",
        userName: "Fatima Ali",
        userReputation: 280,
        isTopContributor: false,
        submittedAt: "2025-11-20T18:20:00Z",
        timings: { fajr: "05:10", zuhr: "13:25", asr: "16:10", maghrib: "17:15", isha: "19:40", jummah: "13:30" },
        notes: "Winter schedule update",
        verified: true,
        verifiedBy: 3,
        status: "outdated"
      }
    ],
    m3: [
      {
        id: "sub3",
        userId: "user789",
        userName: "Omar Hassan",
        userReputation: 850,
        isTopContributor: true,
        submittedAt: "2025-11-23T07:00:00Z",
        timings: { fajr: "05:00", zuhr: "13:30", asr: "16:15", maghrib: "17:25", isha: "20:00", jummah: "13:00", jummah_2: "13:45", jummah_3: "14:30" },
        notes: "Official website update",
        verified: true,
        verifiedBy: 25,
        status: "active"
      }
    ],
    m6: [
      {
        id: "sub4",
        userId: "user999",
        userName: "New User",
        userReputation: 10,
        isTopContributor: false,
        submittedAt: "2025-11-23T11:00:00Z",
        timings: { fajr: "05:25", zuhr: "13:20", asr: "16:05", maghrib: "17:20", isha: "19:35", jummah: "13:15" },
        notes: "I think these are right",
        verified: false,
        verifiedBy: 0,
        status: "pending_verification"
      }
    ]
  },
  // ✨ User contribution stats per mosque
  userContributions: {
    m1: { totalSubmissions: 12, approvedSubmissions: 10, trustScore: 85, isTopContributor: true },
    m3: { totalSubmissions: 45, approvedSubmissions: 42, trustScore: 98, isTopContributor: true }
  },
  // ✨ Pending notifications
  notifications: [
    {
      id: "notif1",
      type: "verification_request",
      mosqueId: "m6",
      mosqueName: "Local Musalla",
      submissionId: "sub4",
      submitterName: "New User",
      createdAt: "2025-11-23T11:00:00Z",
      read: false
    },
    {
      id: "notif2",
      type: "timing_update",
      mosqueId: "m1",
      mosqueName: "Central Jamia Masjid",
      message: "Prayer timings updated by Ahmed Khan",
      createdAt: "2025-11-23T09:30:00Z",
      read: false
    }
  ],
  user: {
    favoriteMosques: storage.getFavorites(),
    totalSubmissions: 57,
    reputation: 1250,
    badges: ["Top Contributor", "Early Adopter", "Verified Helper", "Community Hero"]
  },
  // ✨ Authentication state
  auth: {
    isLoggedIn: false,
    user: null // Will contain: { name, email, picture, id }
  }
};

// Export for use in other modules (if using modules, but for now we'll just use global scope as per original design)
// window.state = state;
// window.storage = storage;
