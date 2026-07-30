// ========================================
// Jamat API Client
// ========================================
// Real fetch-based client. Falls back to the hardcoded mosques in state.js
// when window.JAMAT_CONFIG.useMockData is true (default while backend is offline).
//
// Loaded after js/config.js, js/auth.js, js/state.js — all relied on as globals.

const api = (() => {
  const cfg = () => window.JAMAT_CONFIG;
  const useMock = () => !!cfg()?.useMockData;
  function isLocalDevHost() {
    const h = window.location?.hostname || '';
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h.endsWith('.local') || h.endsWith('.trycloudflare.com');
  }
  function devAuthEnabled() {
    const flag = cfg()?.devAuthEnabled;
    return typeof flag === 'boolean' ? flag : isLocalDevHost();
  }

  async function request(path, { method = 'GET', body, query, requireAuth = false } = {}) {
    const url = new URL(cfg().apiBase + path, window.location.origin);
    if (query) {
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      });
    }

    const headers = { 'Content-Type': 'application/json' };
    // Token preference order:
    //   1. App JWT (post-Google-exchange or post-email-register/login).
    //      Long-lived (30d), unifies email/password and Google flows.
    //   2. Live Firebase ID token (legacy clients that haven't gone
    //      through /auth/google yet — server middleware accepts both).
    //   3. X-Dev-User-Email header (explicit local/dev auth only).
    const appJwt = window.authExchange?.getStoredAppJwt?.() || null;
    // `auth` is loaded as a <script type="module">, which is async. If a
    // request fires before that module is ready, fall back gracefully —
    // we'll just send no Firebase token and rely on the dev-auth header below.
    const hasAuth = typeof window.auth !== 'undefined' && window.auth?.getIdToken;
    const fbToken = !appJwt && hasAuth ? await window.auth.getIdToken().catch(() => null) : null;
    const token = appJwt || fbToken;
    if (token) headers.Authorization = `Bearer ${token}`;

    // Dev-auth: send the chosen email so the server identifies us as that user.
    // Set by the login modal (js/app.js) into localStorage.
    const devEmail = (typeof localStorage !== 'undefined' && localStorage.getItem('jamat_dev_email')) || null;
    if (devEmail && !token && devAuthEnabled()) headers['X-Dev-User-Email'] = devEmail;

    // If Firebase is configured we enforce auth on the client to give a nicer
    // UX. If it isn't (dev / local-only deploy), the server's bypass handles
    // identity, so don't short-circuit here.
    if (requireAuth && !token && ((hasAuth && window.auth.isConfigured?.()) || !devAuthEnabled())) {
      throw new ApiError(401, 'Sign in to do that');
    }

    let res;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiError(0, `Network error: ${err.message}`);
    }

    const text = await res.text();
    const payload = text ? safeJson(text) : null;

    if (!res.ok) {
      // 401 on a request that carried an app JWT means the token is no
      // longer valid (expired, revoked, or the user soft-deleted their
      // account server-side). Clear it locally so the next request goes
      // out anonymous instead of repeatedly 401-ing — and so the UI can
      // route the user back to sign-in. We only clear when we *had* a
      // token; a 401 from a never-authenticated request is just "this
      // route requires login" and shouldn't disturb stored state.
      if (res.status === 401 && token) {
        try { window.authExchange?.clearStoredAppJwt?.(); } catch {}
        try { localStorage.removeItem('jamat_dev_email'); } catch {}
        // Notify UI to refresh sign-in state. Listeners live in app.js.
        try {
          window.dispatchEvent(new CustomEvent('jamat:auth-expired', {
            detail: { path, status: res.status },
          }));
        } catch {}
      }
      const message = payload?.error || payload?.message || res.statusText;
      throw new ApiError(res.status, message, payload);
    }
    return payload;
  }

  function safeJson(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  function normalizeReverseGeocode(data) {
    const a = data?.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ').trim();
    return {
      city: firstString(
        data?.city,
        a.city,
        a.town,
        a.village,
        a.municipality,
        a.city_district,
        a.state_district,
        a.suburb,
        a.county,
        a.state,
      ),
      country: firstString(data?.country, a.country),
      addressLine1: firstString(data?.addressLine1, street, data?.name, String(data?.display_name || '').split(',')[0]),
    };
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 3500) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        signal: controller?.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new ApiError(res.status, 'Location lookup failed');
      return res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---- Adapters: backend response → state.js shape ----
  // The frontend was built around the mock data in state.js. Until the UI is
  // refactored to consume the backend shape directly, we adapt here.
  function adaptMosque(m, opts = {}) {
    const adapted = {
      id: m.id,
      name: m.name,
      nameArabic: m.nameArabic ?? m.name_arabic ?? null,
      address: m.addressLine1 || m.address_line1 || '',
      city: m.city,
      country: m.country,
      coordinates: { lat: m.latitude, lng: m.longitude },
      distanceKm: m.distanceMeters != null ? +(m.distanceMeters / 1000).toFixed(2) : opts.distanceKm,
      rating: m.rating ?? null,
      contributorCount: m.contributorCount ?? m.contributor_count ?? 0,
      lastUpdated: m.updatedAt ?? m.updated_at ?? null,
      phoneNumber: m.phoneNumber ?? m.phone_number ?? '',
      amenities: m.amenities ?? [],
      verified: m.verified ?? false,
      status: m.status ?? 'active',
      addedById: m.addedById ?? m.added_by ?? null,
      canEdit: !!m.canEdit,
      canRename: !!(m.canRename ?? m.canEdit),
      canEditNameOnly: !!m.canEditNameOnly,
      editPermission: m.editPermission ?? null,
      canClose: !!m.canClose,
      canReactivate: !!m.canReactivate,
      defaultJamaatTimings: extractTimings(m),
      effectiveTimings: m.effectiveTimings ?? null,
      effectiveKeeperId: m.effectiveKeeperId ?? null,
      effectiveKeeperName: m.effectiveKeeperName ?? null,
      effectiveKeeperSource: m.effectiveKeeperSource ?? null,
      effectiveKeeperIsCurrentSchedule: !!m.effectiveKeeperIsCurrentSchedule,
      effectiveKeeperIsVerifiedSchedule: !!m.effectiveKeeperIsVerifiedSchedule,
      effectiveKeeperUpdatedAt: m.effectiveKeeperUpdatedAt ?? null,
    };
    // Opportunistic cache write: any time we see a mosque with real
    // timings — nearby list, search, favorites — we save it so a later
    // hero/drawer render can paint immediately without a round-trip.
    if (adapted.defaultJamaatTimings) {
      try { storage.saveMosqueCache?.(adapted); } catch {}
    }
    return adapted;
  }

  function extractTimings(m) {
    const sched = m.prayerSchedules?.[0]?.timings ?? m.activeSchedule?.timings ?? m.timings ?? null;
    if (!sched) return null;
    return {
      fajr: sched.fajr,
      zuhr: sched.dhuhr ?? sched.zuhr,
      asr: sched.asr,
      // Maghrib is computed client-side from astronomical sunset + offset.
      // We carry the offset through; sun.js + components.js render the actual time.
      maghribOffset: typeof sched.maghribOffset === 'number' ? sched.maghribOffset : undefined,
      isha: sched.isha,
      jummah: Array.isArray(sched.jummah) ? sched.jummah[0] : sched.jummah,
      ...(Array.isArray(sched.jummah) && sched.jummah[1] ? { jummah_2: sched.jummah[1] } : {}),
      ...(Array.isArray(sched.jummah) && sched.jummah[2] ? { jummah_3: sched.jummah[2] } : {}),
    };
  }

  // ─── Dars: localStorage-backed mock (only used when useMock() is true) ──
  // Lets the whole Dars flow — create, invite, add members, schedule, remind
  // — be exercised in the browser with no backend/DB. Mirrors the server's
  // serialization shape so js/dars.js can't tell the difference.
  const DARS_MOCK_KEY = 'jamat_dars_mock';
  function darsMockRead() {
    try { return JSON.parse(localStorage.getItem(DARS_MOCK_KEY)) || { groups: [] }; }
    catch { return { groups: [] }; }
  }
  function darsMockWrite(s) { try { localStorage.setItem(DARS_MOCK_KEY, JSON.stringify(s)); } catch {} }
  function darsMockMe() { return (localStorage.getItem('jamat_dev_email') || 'you@local.test'); }
  function darsMockName(email) { return (email || '').split('@')[0] || 'You'; }
  function darsMockCode() { return Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 8) || 'demo1234'; }
  function darsMockSerialize(g) {
    const me = darsMockMe();
    const mine = g.members.find(m => m.userId === me);
    const role = mine ? mine.role : null;
    const isMember = role !== null;
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      shareCode: isMember ? g.shareCode : undefined,
      adminId: g.adminId,
      role,
      memberCount: g.members.length,
      createdAt: g.createdAt,
      members: isMember ? g.members.map(m => ({ userId: m.userId, role: m.role, name: m.name, email: m.userId, joinedAt: m.joinedAt })) : undefined,
      sessions: isMember
        ? g.sessions.filter(s => new Date(s.scheduledAt).getTime() > Date.now())
            .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
        : undefined,
    };
  }
  function darsMockFindByCode(code) {
    return darsMockRead().groups.find(g => g.shareCode === String(code).toLowerCase());
  }

  // ---- Public methods ----
  return {
    // Email/password: returns { token, user } on success. Caller
    // (login modal) is responsible for storing the token via
    // window.authExchange.storeAppJwt.
    async authRegister(email, password) {
      return request('/auth/register', { method: 'POST', body: { email, password } });
    },
    async authLogin(email, password) {
      return request('/auth/login', { method: 'POST', body: { email, password } });
    },
    async getNearbyMosques(lat, lng, radiusKm = 5) {
      if (useMock()) return state.mosques;
      const res = await request('/mosques/nearby', {
        query: { lat, lng, radius: Math.round(radiusKm * 1000), limit: 20 },
      });
      return res.data.map((m) => adaptMosque(m));
    },

    async listMosques({ city, country, search, page = 1, limit = 20 } = {}) {
      if (useMock()) return { data: state.mosques, pagination: { page: 1, limit: state.mosques.length, totalCount: state.mosques.length, totalPages: 1, hasMore: false } };
      const res = await request('/mosques', { query: { city, country, search, page, limit } });
      return { ...res, data: res.data.map((m) => adaptMosque(m)) };
    },

    async getMosque(id) {
      if (useMock()) return state.mosques.find((m) => m.id === id);
      let m;
      try {
        m = await request(`/mosques/${id}`);
      } catch (err) {
        // Network/server failure → return the last good copy so the
        // user keeps seeing their masjid's times. Caller can decide
        // whether to surface the original error (e.g. via toast).
        const cached = storage.getMosqueCache?.(id);
        if (cached) return { ...cached, fromCache: true };
        throw err;
      }
      const result = {
        ...adaptMosque(m),
        isFavorite: m.isFavorite,
        keepers: m.keepers || [],
        preferredKeeperId: m.preferredKeeperId || null,
        effectiveTimings: m.effectiveTimings || null,
        effectiveKeeperId: m.effectiveKeeperId || null,
        effectiveKeeperName: m.effectiveKeeperName || null,
        effectiveKeeperSource: m.effectiveKeeperSource || null,
        effectiveKeeperIsCurrentSchedule: !!m.effectiveKeeperIsCurrentSchedule,
        effectiveKeeperIsVerifiedSchedule: !!m.effectiveKeeperIsVerifiedSchedule,
        effectiveKeeperUpdatedAt: m.effectiveKeeperUpdatedAt || null,
        raw: m,
      };
      // Backfill blanks from cache so a momentarily-empty schedule from
      // the backend (no active keeper, expired schedule, partial deploy)
      // doesn't wipe what the user was already seeing. Bounded by a TTL:
      // the backend is reachable here, so a *persistently* blank response
      // is authoritative — past the TTL we trust the blank rather than
      // showing months-old times for a schedule that was genuinely cleared.
      const BACKFILL_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
      const cached = storage.getMosqueCache?.(id, BACKFILL_MAX_AGE_MS);
      if (cached) {
        if (!result.effectiveTimings && cached.effectiveTimings) {
          result.effectiveTimings = cached.effectiveTimings;
          result.effectiveKeeperId = result.effectiveKeeperId || cached.effectiveKeeperId || null;
          result.effectiveKeeperName = result.effectiveKeeperName || cached.effectiveKeeperName || null;
          result.effectiveKeeperSource = result.effectiveKeeperSource || cached.effectiveKeeperSource || null;
          result.effectiveKeeperIsCurrentSchedule = result.effectiveKeeperIsCurrentSchedule || !!cached.effectiveKeeperIsCurrentSchedule;
          result.effectiveKeeperIsVerifiedSchedule = result.effectiveKeeperIsVerifiedSchedule || !!cached.effectiveKeeperIsVerifiedSchedule;
          result.effectiveKeeperUpdatedAt = result.effectiveKeeperUpdatedAt || cached.effectiveKeeperUpdatedAt || null;
        }
        if (!result.defaultJamaatTimings && cached.defaultJamaatTimings) {
          result.defaultJamaatTimings = cached.defaultJamaatTimings;
        }
      }
      // Persist the richer merged result (incl. effectiveTimings + keepers)
      // for next time. adaptMosque already wrote a thinner record above;
      // this overwrite is intentional.
      if (result.effectiveTimings || result.defaultJamaatTimings) {
        try { storage.saveMosqueCache?.(result); } catch {}
      }
      return result;
    },

    async setPreferredKeeper(mosqueId, keeperUserId) {
      return request('/users/me/preferred-keeper', {
        method: 'PUT',
        body: { mosqueId, keeperUserId },
        requireAuth: true,
      });
    },

    async withdrawAsKeeper(mosqueId) {
      return request(`/mosques/${mosqueId}/keepers/me/withdraw`, {
        method: 'POST',
        requireAuth: true,
      });
    },

    async getMosqueCaptcha() {
      if (useMock()) return { id: 'mock-captcha', question: 'What is 2 + 3?', expiresInSeconds: 600 };
      return request('/mosques/captcha');
    },

    async reverseGeocode(lat, lng) {
      const latNum = Number(lat);
      const lngNum = Number(lng);
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return {};
      const nominatim = 'https://nominatim.openstreetmap.org/reverse'
        + `?format=jsonv2&lat=${encodeURIComponent(latNum)}&lon=${encodeURIComponent(lngNum)}`
        + '&addressdetails=1&zoom=16&accept-language=en';
      try {
        return normalizeReverseGeocode(await fetchJsonWithTimeout(nominatim));
      } catch {
        try {
          return normalizeReverseGeocode(await request('/geocode/reverse', {
            query: { lat: latNum, lng: lngNum },
          }));
        } catch {
          return {};
        }
      }
    },

    async createMosque(payload) {
      const created = await request('/mosques', { method: 'POST', body: payload, requireAuth: true });
      return adaptMosque(created);
    },

    async updateMosque(id, patch) {
      const updated = await request(`/mosques/${id}`, { method: 'PUT', body: patch, requireAuth: true });
      return adaptMosque(updated);
    },

    async setMosqueStatus(id, status) {
      const updated = await request(`/mosques/${id}/status`, {
        method: 'POST',
        body: { status },
        requireAuth: true,
      });
      return {
        ...adaptMosque(updated),
        withdrawnCurrentKeeper: !!updated.withdrawnCurrentKeeper,
        withdrawnSubmissions: updated.withdrawnSubmissions ?? 0,
        withdrawnSchedules: updated.withdrawnSchedules ?? 0,
        replacementKeeperId: updated.replacementKeeperId ?? null,
        replacementKeeperName: updated.replacementKeeperName ?? null,
      };
    },

    async submitMosqueReview(mosqueId, review) {
      if (useMock()) return { id: 'mock-review', mosqueId, ...review };
      return request(`/mosques/${mosqueId}/reviews`, {
        method: 'POST',
        body: review,
        requireAuth: true,
      });
    },

    async toggleFavorite(mosqueId) {
      if (useMock()) {
        const idx = state.user.favoriteMosques.indexOf(mosqueId);
        if (idx === -1) state.user.favoriteMosques.push(mosqueId);
        else state.user.favoriteMosques.splice(idx, 1);
        storage.saveFavorites(state.user.favoriteMosques);
        return { favorite: idx === -1 };
      }
      const res = await request(`/mosques/${mosqueId}/favorite`, { method: 'POST', requireAuth: true });
      // Mirror server state into local cache so UI reactions are instant.
      const has = state.user.favoriteMosques.includes(mosqueId);
      if (res.favorite && !has) state.user.favoriteMosques.push(mosqueId);
      if (!res.favorite && has) state.user.favoriteMosques.splice(state.user.favoriteMosques.indexOf(mosqueId), 1);
      storage.saveFavorites(state.user.favoriteMosques);
      return res;
    },

    async listFavorites() {
      if (useMock()) {
        return state.mosques.filter((m) => state.user.favoriteMosques.includes(m.id));
      }
      const res = await request('/users/me/favorites', { requireAuth: true });
      return res.data.map((f) => adaptMosque(f.mosque));
    },

    async getMyProfile() {
      if (useMock()) return state.user;
      return request('/users/me', { requireAuth: true });
    },

    async updateMyProfile(patch) {
      if (useMock()) {
        Object.assign(state.user, patch);
        return state.user;
      }
      return request('/users/me', { method: 'PUT', body: patch, requireAuth: true });
    },

    async submitTimings({ mosqueId, timings, notes, isVerifiedOnsite = false, proofPhotos = [] }) {
      if (useMock()) {
        const mock = { id: 'mock-' + Date.now(), mosqueId, timings, notes, status: 'pending' };
        (state.submissions[mosqueId] ||= []).push(mock);
        return mock;
      }
      // Backend uses HH:mm and `dhuhr`; map from frontend's `zuhr`. Maghrib
      // is astronomical, not contributor-set — we send `maghribOffset` (number
      // of minutes after sunset) instead of an HH:MM time.
      const mapped = {
        fajr: timings.fajr,
        dhuhr: timings.zuhr ?? timings.dhuhr,
        asr: timings.asr,
        maghribOffset: typeof timings.maghribOffset === 'number' ? timings.maghribOffset : undefined,
        isha: timings.isha,
        jummah: [timings.jummah, timings.jummah_2, timings.jummah_3].filter(Boolean),
      };
      return request('/submissions', {
        method: 'POST',
        body: { mosqueId, timings: mapped, notes, isVerifiedOnsite, proofPhotos },
        requireAuth: true,
      });
    },

    async listSubmissionsForMosque(mosqueId, status) {
      if (useMock()) return state.submissions[mosqueId] || [];
      const res = await request('/submissions', { query: { mosqueId, status } });
      return res.data;
    },

    async voteSubmission(submissionId, voteType, reportReason) {
      if (useMock()) return { voted: true, voteType };
      return request(`/submissions/${submissionId}/vote`, {
        method: 'POST',
        body: { voteType, reportReason },
        requireAuth: true,
      });
    },

    // ─── Suggestions: user → keeper timing-update proposals ─────────
    // Same `timings` shape as submitTimings (HH:MM strings + maghribOffset).
    // The keeper sees pending suggestions in their inbox top-bar.
    async createSuggestion({ toUserId, mosqueId, timings, notes }) {
      const mapped = {
        fajr: timings.fajr,
        dhuhr: timings.zuhr ?? timings.dhuhr,
        asr: timings.asr,
        maghribOffset: typeof timings.maghribOffset === 'number' ? timings.maghribOffset : undefined,
        isha: timings.isha,
        jummah: [timings.jummah, timings.jummah_2, timings.jummah_3].filter(Boolean),
      };
      return request('/suggestions', {
        method: 'POST',
        body: { toUserId, mosqueId, timings: mapped, notes },
        requireAuth: true,
      });
    },
    async putMyReminderPrefs(prefs) {
      return request('/users/me/reminder-prefs', { method: 'PUT', body: prefs, requireAuth: true });
    },

    async listQazaRecords({ status = 'open' } = {}) {
      if (useMock()) return { records: storage.getQazaRecords?.() || [] };
      return request('/qaza', { query: { status }, requireAuth: true });
    },

    async createQazaRecord(record) {
      if (useMock()) return { record, created: true };
      return request('/qaza', { method: 'POST', body: record, requireAuth: true });
    },

    async markQazaRecordPrayed(id, prayedAt) {
      if (useMock()) return { record: { id, prayedAt: prayedAt || new Date().toISOString() } };
      return request(`/qaza/${id}/prayed`, {
        method: 'PATCH',
        body: { prayedAt: prayedAt || new Date().toISOString() },
        requireAuth: true,
      });
    },

    async listSuggestionInbox() {
      if (useMock()) return { suggestions: [] };
      return request('/suggestions/inbox', { requireAuth: true });
    },
    async acceptSuggestion(id) {
      return request(`/suggestions/${id}/accept`, { method: 'POST', requireAuth: true });
    },
    async declineSuggestion(id, note) {
      return request(`/suggestions/${id}/decline`, { method: 'POST', body: { note }, requireAuth: true });
    },

    async listNotifications({ unread = false } = {}) {
      if (useMock()) return { data: state.notifications, unreadCount: state.notifications.filter((n) => !n.read).length };
      return request('/users/me/notifications', { query: { unread }, requireAuth: true });
    },

    async markNotificationRead(id) {
      if (useMock()) {
        const n = state.notifications.find((x) => x.id === id);
        if (n) n.read = true;
        return { id, read: true };
      }
      return request(`/users/me/notifications/${id}/read`, { method: 'PATCH', requireAuth: true });
    },

    async markAllNotificationsRead() {
      if (useMock()) {
        state.notifications.forEach((n) => { n.read = true; });
        return { marked: state.notifications.length };
      }
      return request('/users/me/notifications/read-all', { method: 'POST', requireAuth: true });
    },

    async deleteMyAccount() {
      if (useMock()) return { id: state.user?.id || 'mock-user', deleted: true, alreadyDeleted: false };
      return request('/users/me', { method: 'DELETE', requireAuth: true });
    },

    // ─── Dars (Islamic lesson groups) ───────────────────────────────
    async listDarsGroups() {
      if (useMock()) {
        const me = darsMockMe();
        const groups = darsMockRead().groups
          .filter(g => g.members.some(m => m.userId === me))
          .map(darsMockSerialize);
        return { groups };
      }
      return request('/dars', { requireAuth: true });
    },
    async createDarsGroup({ name, description } = {}) {
      if (useMock()) {
        const me = darsMockMe();
        const store = darsMockRead();
        const g = {
          id: 'g_' + darsMockCode(),
          name, description: description || null,
          shareCode: darsMockCode(),
          adminId: me,
          createdAt: new Date().toISOString(),
          members: [{ userId: me, role: 'admin', name: darsMockName(me), joinedAt: new Date().toISOString() }],
          sessions: [],
        };
        store.groups.push(g);
        darsMockWrite(store);
        return { group: darsMockSerialize(g) };
      }
      return request('/dars', { method: 'POST', body: { name, description }, requireAuth: true });
    },
    async getDarsGroup(id) {
      if (useMock()) {
        const g = darsMockRead().groups.find(x => x.id === id);
        if (!g) throw new ApiError(404, 'Dars group not found');
        return { group: darsMockSerialize(g) };
      }
      return request(`/dars/${id}`, { requireAuth: true });
    },
    // Preview an invite before committing to join (share-link landing).
    async previewDarsInvite(code) {
      if (useMock()) {
        const g = darsMockFindByCode(code);
        if (!g) throw new ApiError(404, 'That invite link is invalid or expired');
        const me = darsMockMe();
        return { group: { id: g.id, name: g.name, description: g.description, memberCount: g.members.length, alreadyMember: g.members.some(m => m.userId === me) } };
      }
      return request(`/dars/join/${encodeURIComponent(code)}`, { requireAuth: true });
    },
    async joinDarsGroup(code) {
      if (useMock()) {
        const store = darsMockRead();
        const g = store.groups.find(x => x.shareCode === String(code).toLowerCase());
        if (!g) throw new ApiError(404, 'That invite link is invalid or expired');
        const me = darsMockMe();
        if (!g.members.some(m => m.userId === me)) {
          g.members.push({ userId: me, role: 'member', name: darsMockName(me), joinedAt: new Date().toISOString() });
          darsMockWrite(store);
        }
        return { group: darsMockSerialize(g) };
      }
      return request(`/dars/join/${encodeURIComponent(code)}`, { method: 'POST', requireAuth: true });
    },
    async addDarsMember(groupId, email) {
      if (useMock()) {
        const store = darsMockRead();
        const g = store.groups.find(x => x.id === groupId);
        if (!g) throw new ApiError(404, 'Dars group not found');
        const uid = String(email).toLowerCase();
        if (g.members.some(m => m.userId === uid)) throw new ApiError(400, 'That person is already in the group');
        g.members.push({ userId: uid, role: 'member', name: darsMockName(uid), joinedAt: new Date().toISOString() });
        darsMockWrite(store);
        return { group: darsMockSerialize(g) };
      }
      return request(`/dars/${groupId}/members`, { method: 'POST', body: { email }, requireAuth: true });
    },
    async removeDarsMember(groupId, userId) {
      if (useMock()) {
        const store = darsMockRead();
        const g = store.groups.find(x => x.id === groupId);
        if (!g) throw new ApiError(404, 'Dars group not found');
        g.members = g.members.filter(m => m.userId !== userId || m.role === 'admin');
        darsMockWrite(store);
        return { group: darsMockSerialize(g) };
      }
      return request(`/dars/${groupId}/members/${userId}`, { method: 'DELETE', requireAuth: true });
    },
    async scheduleDars(groupId, { title, scheduledAt, notify } = {}) {
      if (useMock()) {
        const store = darsMockRead();
        const g = store.groups.find(x => x.id === groupId);
        if (!g) throw new ApiError(404, 'Dars group not found');
        g.sessions.push({ id: 's_' + darsMockCode(), title: title || null, scheduledAt, createdById: darsMockMe() });
        darsMockWrite(store);
        return { group: darsMockSerialize(g) };
      }
      return request(`/dars/${groupId}/sessions`, { method: 'POST', body: { title, scheduledAt, notify }, requireAuth: true });
    },
    // The "remind everyone" button — admin fans a push out to all members.
    async remindDars(groupId, { message, sessionId } = {}) {
      if (useMock()) {
        // No real push in mock mode — report "not sent" so the UI shows the
        // honest "queued (push off)" toast, same as a dev backend with FCM off.
        return { ok: true, delivery: { sent: false, reason: 'disabled', topic: `dars-group-${groupId}` } };
      }
      return request(`/dars/${groupId}/remind`, { method: 'POST', body: { message, sessionId }, requireAuth: true });
    },
  };
})();

class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

window.ApiError = ApiError;
// Expose the api object on window so other modules (reminders.js, etc.) can
// dispatch fire-and-forget calls without chaining through app.js.
window.api = api;
