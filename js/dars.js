// ═══════════════════════════════════════════════════════════════════
// Dars — Islamic lesson groups.
//
// A self-contained UI module that drives the #dars-drawer. Responsibilities:
//   - list the groups you're in / create a new one (you become admin)
//   - group detail: members, upcoming lessons, share link
//   - admin actions: add member by email, schedule a lesson (2-step picker),
//     and the "Remind everyone" button that fans a push out to all members
//   - join a group from a shared invite link (#dars/join/<code>)
//   - subscribe this device to the group's FCM topic (dars-group-<id>) so
//     the reminder push actually lands — mirrors the keeper-follow model
//
// Talks to the backend through window.api.* (see js/api.js) and to native
// push through window.takbeerPush.* (see mobile/native-bridge.js). Both are
// optional at runtime: in a plain browser without the native shell, the
// group still works; only the OS push is a no-op (the server logs the send).
//
// Routing is hash-based and owned here so it doesn't tangle with app.js's
// applyHashState (which only knows map/drawer/qaza/login/inbox):
//   #dars                 → my groups
//   #dars/group/<id>      → one group
//   #dars/join/<code>     → invite landing
// ═══════════════════════════════════════════════════════════════════

const dars = (() => {
  let drawer, body, backBtn, pill, pillCount;
  let state = {
    view: 'list',      // 'list' | 'create' | 'detail' | 'join'
    groups: [],
    current: null,     // full group object in detail view
    joinCode: null,
    loading: false,
  };

  const R = () => window.JAMAT_RENDER;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ─── Auth hint (mirrors app.js getEmail, without reaching into it) ──
  function signedInEmail() {
    try {
      // Mock mode (?mock=1): no real auth — seed a demo identity so the whole
      // Dars flow is reachable without signing in against a live backend.
      if (window.JAMAT_CONFIG?.useMockData) {
        let demo = localStorage.getItem('jamat_dev_email');
        if (!demo) { demo = 'you@local.test'; try { localStorage.setItem('jamat_dev_email', demo); } catch {} }
        return demo;
      }
      const email = localStorage.getItem('jamat_dev_email');
      if (!email) return null;
      const hasJwt = !!window.authExchange?.getStoredAppJwt?.();
      const h = location.hostname || '';
      const devAuth = h === 'localhost' || h === '127.0.0.1' || h === '' ||
        h.endsWith('.local') || h.endsWith('.trycloudflare.com');
      return (hasJwt || devAuth) ? email : null;
    } catch { return null; }
  }

  // ─── Lightweight toast (app.js's toast lives inside its IIFE) ────────
  function toast(msg) {
    let host = document.getElementById('dars-toast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'dars-toast';
      host.className = 'dars-toast';
      document.body.appendChild(host);
    }
    host.textContent = msg;
    host.classList.add('is-shown');
    clearTimeout(host._t);
    host._t = setTimeout(() => host.classList.remove('is-shown'), 3200);
  }

  // 401 → nudge to sign in via the existing login overlay.
  function handleError(err, fallback) {
    if (err && err.status === 401) {
      toast('Sign in to use Dars');
      location.hash = 'login';
      return;
    }
    toast((err && err.message) || fallback || 'Something went wrong');
  }

  // ─── Native push topic per group ────────────────────────────────────
  const topicFor = (id) => `dars-group-${id}`;
  function subscribeTopic(id) {
    try { window.takbeerPush?.subscribe?.(topicFor(id)); } catch {}
  }
  function unsubscribeTopic(id) {
    try { window.takbeerPush?.unsubscribe?.(topicFor(id)); } catch {}
  }

  // ─── Per-group reminder preferences (member-side settings) ──────────
  // { [groupId]: { notify: bool, minutesBefore: number|null } }
  //   notify        — receive reminders for this group at all (topic sub)
  //   minutesBefore — auto-remind me this many minutes before each lesson
  //                   (a local notification; independent of the admin's
  //                   manual "remind everyone" push)
  const PREFS_KEY = 'jamat_dars_prefs';
  function allPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch { return {}; }
  }
  function groupPrefs(id) {
    const p = allPrefs()[id] || {};
    return { notify: p.notify !== false, minutesBefore: (typeof p.minutesBefore === 'number' ? p.minutesBefore : null) };
  }
  function setGroupPrefs(id, patch) {
    const all = allPrefs();
    all[id] = { ...groupPrefs(id), ...patch };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(all)); } catch {}
    return all[id];
  }

  // Web fallback timers for advance reminders (native uses takbeerLocalDars).
  const webTimers = {};   // groupId -> [timeoutId,...]

  // Apply a group's reminder prefs: (un)subscribe the push topic and
  // (re)schedule the "N minutes before each lesson" local reminders for its
  // upcoming sessions. Safe to call repeatedly — it cancels before it
  // reschedules. `group` must be a full detail object (has .members/.sessions).
  function applyReminderPrefs(group) {
    if (!group || !group.id) return;
    const prefs = groupPrefs(group.id);

    // 1. Topic subscription (the mute switch).
    if (prefs.notify) subscribeTopic(group.id);
    else unsubscribeTopic(group.id);

    // 2. Advance local reminders. Clear any previously-scheduled ones first.
    try { window.takbeerLocalDars?.cancel?.(group.id); } catch {}
    (webTimers[group.id] || []).forEach(clearTimeout);
    webTimers[group.id] = [];

    if (!prefs.notify || !prefs.minutesBefore || prefs.minutesBefore <= 0) return;
    const sessions = (group.sessions || []).filter(s => new Date(s.scheduledAt).getTime() > Date.now());
    if (!sessions.length) return;

    const items = sessions.map(s => {
      const fireAt = new Date(new Date(s.scheduledAt).getTime() - prefs.minutesBefore * 60000);
      return {
        sessionId: s.id,
        groupId: group.id,
        title: `Dars reminder — ${group.name}`,
        body: `${group.name} starts in ${prefs.minutesBefore} min${s.title ? ' · ' + s.title : ''}.`,
        fireAt,
      };
    }).filter(it => it.fireAt.getTime() > Date.now());

    if (window.takbeerLocalDars) {
      // Native: OS-level scheduled notifications (fire even if app is closed).
      try { window.takbeerLocalDars.schedule(items); } catch {}
    } else {
      // Web: setTimeout + Notification, only lives while the tab is open.
      items.forEach(it => {
        const delay = it.fireAt.getTime() - Date.now();
        if (delay <= 0 || delay > 2 ** 31 - 1) return;
        const t = setTimeout(() => {
          try { window.reminders?.playChime?.(); } catch {}
          if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification(it.title, { body: it.body, tag: `dars-${it.sessionId}` }); } catch {}
          } else {
            toast(it.body);
          }
        }, delay);
        webTimers[group.id].push(t);
      });
    }
  }

  // ─── Open / close ───────────────────────────────────────────────────
  function open() {
    if (!drawer) return;
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('dars-open');
    pill?.setAttribute('aria-expanded', 'true');
  }
  function close() {
    if (!drawer) return;
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('dars-open');
    pill?.setAttribute('aria-expanded', 'false');
    if (location.hash.startsWith('#dars')) {
      history.replaceState({}, '', location.pathname + location.search);
    }
  }

  // ─── Share link ─────────────────────────────────────────────────────
  function shareUrl(code) {
    return `${location.origin}/#dars/join/${code}`;
  }
  function inviteDetails(group) {
    const url = shareUrl(group.shareCode);
    return {
      url,
      text: `Join "${group.name}" on Takbeer Time for our Dars: ${url}`,
    };
  }
  async function shareInvite(group) {
    const { url, text } = inviteDetails(group);
    // Prefer the native/OS share sheet (covers WhatsApp, etc.); fall back
    // to clipboard so the link is never lost.
    if (navigator.share) {
      try { await navigator.share({ title: group.name, text, url }); return; }
      catch { /* user cancelled or unsupported — fall through to copy */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied');
    } catch {
      // Last resort: WhatsApp web intent.
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
  }

  function shareInviteVia(network, group) {
    const { url, text } = inviteDetails(group);
    const destination = network === 'whatsapp'
      ? `https://wa.me/?text=${encodeURIComponent(text)}`
      : `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    window.open(destination, '_blank', 'noopener,noreferrer');
  }
  // ─── Data ───────────────────────────────────────────────────────────
  async function loadGroups() {
    state.loading = true; render();
    try {
      const { groups } = await window.api.listDarsGroups();
      state.groups = groups || [];
      // Reconcile push subscription + advance reminders with each group's
      // saved preference (respects a muted group).
      state.groups.forEach(g => applyReminderPrefs(g));
      updatePillCount();
    } catch (err) {
      if (err && err.status === 401) { state.groups = []; }
      else handleError(err, 'Could not load your groups');
    } finally {
      state.loading = false; render();
    }
  }

  async function loadGroup(id) {
    state.loading = true; state.view = 'detail'; render();
    try {
      const { group } = await window.api.getDarsGroup(id);
      state.current = group;
      applyReminderPrefs(group);
    } catch (err) {
      handleError(err, 'Could not open that group');
      state.view = 'list';
    } finally {
      state.loading = false; render();
    }
  }

  // ═══ Rendering ══════════════════════════════════════════════════════
  function render() {
    if (!body) return;
    backBtn.hidden = !(state.view === 'detail' || state.view === 'create' || state.view === 'join');
    if (state.loading) { body.innerHTML = `<div class="dars-loading">Loading…</div>`; return; }
    if (!signedInEmail() && state.view === 'list') { body.innerHTML = renderSignedOut(); wire(); return; }
    if (state.view === 'create') body.innerHTML = renderCreate();
    else if (state.view === 'join') body.innerHTML = renderJoin();
    else if (state.view === 'detail') body.innerHTML = renderDetail();
    else body.innerHTML = renderList();
    wire();
  }

  function renderSignedOut() {
    return `
      <div class="dars-empty">
        <p class="dars-empty__title">Sign in to start a Dars</p>
        <p class="dars-empty__sub">Create a study circle, invite people with a shareable link, and remind everyone when it's time.</p>
        <button class="btn btn--primary" data-dars-signin type="button">Sign in</button>
      </div>`;
  }

  function renderList() {
    const groups = state.groups;
    const cards = groups.map(g => {
      const next = (g.sessions && g.sessions[0]) || null;
      const nextLine = next
        ? `<span class="dars-card__next">Next: ${esc(fmtWhen(next.scheduledAt))}${next.title ? ' · ' + esc(next.title) : ''}</span>`
        : `<span class="dars-card__next dars-card__next--none">No lesson scheduled</span>`;
      const badge = g.role === 'admin' ? `<span class="dars-badge">Admin</span>` : '';
      return `
        <button class="dars-card" data-open-group="${esc(g.id)}" type="button">
          <span class="dars-card__top">
            <span class="dars-card__name">${esc(g.name)}</span>
            ${badge}
          </span>
          <span class="dars-card__meta">${g.memberCount} member${g.memberCount === 1 ? '' : 's'}</span>
          ${nextLine}
        </button>`;
    }).join('');

    return `
      <div class="dars-actions-row">
        <button class="btn btn--primary" data-dars-new type="button">+ New Dars group</button>
        <button class="btn btn--ghost" data-dars-join-manual type="button">Join with a code</button>
      </div>
      ${groups.length
        ? `<div class="dars-list">${cards}</div>`
        : `<div class="dars-empty">
             <p class="dars-empty__title">No groups yet</p>
             <p class="dars-empty__sub">Create your first Dars group, then invite people with a shareable link.</p>
           </div>`}
    `;
  }

  function renderCreate() {
    return `
      <form class="dars-form" id="dars-create-form">
        <h3 class="dars-form__title">New Dars group</h3>
        <label class="dars-field">
          <span>Group name</span>
          <input type="text" id="dars-name" maxlength="120" placeholder="e.g. Tafsir after Isha" required />
        </label>
        <label class="dars-field">
          <span>Description <em>(optional)</em></span>
          <textarea id="dars-desc" maxlength="2000" rows="3" placeholder="What is this Dars about?"></textarea>
        </label>
        <div class="dars-form__actions">
          <button class="btn btn--primary" type="submit">Create group</button>
          <button class="btn btn--ghost" type="button" data-dars-cancel>Cancel</button>
        </div>
      </form>`;
  }

  function renderJoin() {
    const g = state.joinPreview;
    if (!g) {
      return `
        <form class="dars-form" id="dars-join-form">
          <h3 class="dars-form__title">Join a Dars group</h3>
          <label class="dars-field">
            <span>Invite code</span>
            <input type="text" id="dars-join-code" placeholder="e.g. a1b2c3d4" autocapitalize="none" spellcheck="false" />
          </label>
          <div class="dars-form__actions">
            <button class="btn btn--primary" type="submit">Find group</button>
            <button class="btn btn--ghost" type="button" data-dars-cancel>Cancel</button>
          </div>
        </form>`;
    }
    return `
      <div class="dars-join-card">
        <p class="dars-join-card__eyebrow">You're invited to join</p>
        <h3 class="dars-join-card__name">${esc(g.name)}</h3>
        ${g.description ? `<p class="dars-join-card__desc">${esc(g.description)}</p>` : ''}
        <p class="dars-join-card__meta">${g.memberCount} member${g.memberCount === 1 ? '' : 's'}</p>
        <div class="dars-form__actions">
          ${g.alreadyMember
            ? `<button class="btn btn--primary" data-open-group="${esc(g.id)}" type="button">Open group</button>`
            : `<button class="btn btn--primary" data-dars-confirm-join="${esc(state.joinCode)}" type="button">Join this Dars</button>`}
          <button class="btn btn--ghost" type="button" data-dars-cancel>Not now</button>
        </div>
      </div>`;
  }

  function renderDetail() {
    const g = state.current;
    if (!g) return `<div class="dars-loading">Loading…</div>`;
    const isAdmin = g.role === 'admin';
    const members = g.members || [];
    const sessions = g.sessions || [];

    // The prominent "remind everyone" button lives at the very top for the
    // admin — that's the primary group action.
    const remindBar = isAdmin ? `
      <div class="dars-remind-bar">
        <button class="btn btn--primary dars-remind-btn" data-dars-remind="${esc(g.id)}" type="button">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9zM10 21a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>
          Remind everyone to attend
        </button>
      </div>` : '';

    const sessionsHtml = sessions.length
      ? `<ul class="dars-sessions">${sessions.map(s => `
          <li class="dars-session">
            <span class="dars-session__when">${esc(fmtWhen(s.scheduledAt))}</span>
            ${s.title ? `<span class="dars-session__title">${esc(s.title)}</span>` : ''}
            ${isAdmin ? `<button class="dars-session__remind" data-dars-remind="${esc(g.id)}" data-session="${esc(s.id)}" type="button" title="Remind about this lesson">Remind</button>` : ''}
          </li>`).join('')}</ul>`
      : `<p class="dars-muted">No upcoming lessons scheduled${isAdmin ? '. Add one below.' : ' yet.'}</p>`;

    const scheduler = isAdmin ? renderScheduler(g) : '';

    // Member-side reminder settings for THIS group.
    const prefs = groupPrefs(g.id);
    const settingsHtml = `
      <section class="dars-section dars-settings">
        <h4 class="dars-section__title">Reminder settings</h4>
        <label class="dars-setting-row">
          <span class="dars-setting-row__label">Notify me about this Dars</span>
          <button type="button" class="dars-switch ${prefs.notify ? 'is-on' : ''}" role="switch" aria-checked="${prefs.notify}" data-dars-notify-toggle>
            <span class="dars-switch__thumb"></span>
          </button>
        </label>
        <div class="dars-setting-sub" ${prefs.notify ? '' : 'hidden'}>
          <label class="dars-setting-row">
            <span class="dars-setting-row__label">Remind me before each lesson</span>
            <span class="dars-minutes">
              <input type="number" inputmode="numeric" min="0" max="1440" id="dars-minutes-before" value="${prefs.minutesBefore != null ? prefs.minutesBefore : ''}" placeholder="0" />
              <span class="dars-minutes__suffix">min before</span>
            </span>
          </label>
          <p class="dars-muted dars-muted--sm">${prefs.minutesBefore ? `You'll get a heads-up ${prefs.minutesBefore} min before each scheduled lesson.` : 'Set minutes to get an automatic heads-up before each lesson. Leave empty for none.'}</p>
        </div>
      </section>`;

    const membersHtml = members.map(m => `
      <li class="dars-member">
        <span class="dars-member__avatar" aria-hidden="true">${esc((m.name || '?').charAt(0).toUpperCase())}</span>
        <span class="dars-member__name">${esc(m.name)}${m.role === 'admin' ? ' <span class="dars-badge dars-badge--sm">Admin</span>' : ''}</span>
        ${isAdmin && m.role !== 'admin' ? `<button class="dars-member__remove" data-remove-member="${esc(m.userId)}" type="button" aria-label="Remove ${esc(m.name)}">Remove</button>` : ''}
      </li>`).join('');

    const addMember = isAdmin ? `
      <form class="dars-add-member" id="dars-add-member-form">
        <input type="email" id="dars-member-email" placeholder="person@email.com" />
        <button class="btn btn--ghost btn--sm" type="submit">Add</button>
      </form>` : '';

    return `
      ${remindBar}
      <div class="dars-detail-head">
        <h3 class="dars-detail__name">${esc(g.name)}</h3>
        ${g.description ? `<p class="dars-detail__desc">${esc(g.description)}</p>` : ''}
      </div>

      <div class="dars-share">
        <div class="dars-share__intro">
          <span class="dars-share__label">Invite people</span>
          <span class="dars-share__hint">Send the group link in one tap</span>
        </div>
        <code class="dars-share__code">${esc(shareUrl(g.shareCode))}</code>
        <div class="dars-share__actions">
          <button class="btn btn--sm dars-share__button dars-share__button--whatsapp" data-dars-share-via="whatsapp" type="button">WhatsApp</button>
          <button class="btn btn--sm dars-share__button dars-share__button--facebook" data-dars-share-via="facebook" type="button">Facebook</button>
          <button class="btn btn--ghost btn--sm" data-dars-share type="button">More</button>
        </div>
      </div>
      <section class="dars-section">
        <h4 class="dars-section__title">Upcoming lessons</h4>
        ${sessionsHtml}
        ${scheduler}
      </section>

      ${settingsHtml}

      <section class="dars-section">
        <h4 class="dars-section__title">Members <span class="dars-count">${members.length}</span></h4>
        <ul class="dars-members">${membersHtml}</ul>
        ${addMember}
      </section>
    `;
  }

  // Two-step scheduler: pick an upcoming day (chips), then time + title.
  function renderScheduler(g) {
    const days = upcomingDays(14);
    const sel = state.schedDay;
    const chips = days.map(d => `
      <button type="button" class="dars-day ${sel === d.iso ? 'is-active' : ''}" data-day="${d.iso}">
        <span class="dars-day__dow">${esc(d.dow)}</span>
        <span class="dars-day__date">${esc(d.label)}</span>
      </button>`).join('');

    const step2 = sel ? `
      <div class="dars-sched-step2">
        <label class="dars-field dars-field--inline">
          <span>Time</span>
          <input type="time" id="dars-sched-time" value="${esc(state.schedTime || '20:00')}" />
        </label>
        <label class="dars-field">
          <span>Topic <em>(optional)</em></span>
          <input type="text" id="dars-sched-title" maxlength="160" placeholder="e.g. Surah Al-Kahf" value="${esc(state.schedTitle || '')}" />
        </label>
        <label class="dars-check">
          <input type="checkbox" id="dars-sched-notify" checked />
          <span>Notify members now</span>
        </label>
        <div class="dars-form__actions">
          <button class="btn btn--primary" data-dars-schedule-confirm="${esc(g.id)}" type="button">Schedule lesson</button>
        </div>
      </div>` : `<p class="dars-muted dars-muted--sm">Pick a day to continue.</p>`;

    return `
      <details class="dars-scheduler" ${state.schedOpen ? 'open' : ''}>
        <summary class="dars-scheduler__summary">+ Schedule a lesson</summary>
        <div class="dars-scheduler__body">
          <p class="dars-sched-label">Choose a day</p>
          <div class="dars-days">${chips}</div>
          ${step2}
        </div>
      </details>`;
  }

  // ─── Date helpers ───────────────────────────────────────────────────
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function upcomingDays(n) {
    const out = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < n; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      let dow = DOW[d.getDay()];
      if (i === 0) dow = 'Today';
      else if (i === 1) dow = 'Tomorrow';
      out.push({ iso, dow, label: `${MON[d.getMonth()]} ${d.getDate()}` });
    }
    return out;
  }

  // ISO date + "HH:MM" (local) → a Date, then ISO string with offset for the API.
  function combineLocal(isoDate, hhmm) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const [hh, mm] = (hhmm || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  }

  // Pretty "Fri, Jul 31 · 8:00 PM" from an ISO timestamp.
  function fmtWhen(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const t = R()?.fmt12 ? R().fmt12(hhmm) : hhmm;
    return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()} · ${t}`;
  }

  function updatePillCount() {
    if (!pillCount) return;
    const n = state.groups.length;
    pillCount.hidden = n === 0;
    pillCount.textContent = String(n);
  }

  // ═══ Event wiring (re-bound after each render) ══════════════════════
  function wire() {
    body.querySelector('[data-dars-signin]')?.addEventListener('click', () => { location.hash = 'login'; });
    body.querySelector('[data-dars-new]')?.addEventListener('click', () => { state.view = 'create'; render(); });
    body.querySelector('[data-dars-join-manual]')?.addEventListener('click', () => {
      state.view = 'join'; state.joinPreview = null; state.joinCode = null; render();
    });
    body.querySelector('[data-dars-cancel]')?.addEventListener('click', () => {
      state.view = 'list'; state.joinPreview = null; goList();
    });

    body.querySelectorAll('[data-open-group]').forEach(btn =>
      btn.addEventListener('click', () => { location.hash = `dars/group/${btn.getAttribute('data-open-group')}`; }));

    // Create
    body.querySelector('#dars-create-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = body.querySelector('#dars-name').value.trim();
      const description = body.querySelector('#dars-desc').value.trim();
      if (name.length < 2) { toast('Give the group a name'); return; }
      try {
        const { group } = await window.api.createDarsGroup({ name, description });
        subscribeTopic(group.id);
        toast('Group created');
        location.hash = `dars/group/${group.id}`;
      } catch (err) { handleError(err, 'Could not create the group'); }
    });

    // Join by code (manual)
    body.querySelector('#dars-join-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = body.querySelector('#dars-join-code').value.trim().toLowerCase();
      if (!code) { toast('Enter an invite code'); return; }
      previewJoin(code);
    });
    body.querySelector('[data-dars-confirm-join]')?.addEventListener('click', (e) =>
      confirmJoin(e.currentTarget.getAttribute('data-dars-confirm-join')));

    // Detail: share, remind, add/remove member, scheduler
    body.querySelector('[data-dars-share]')?.addEventListener('click', () => shareInvite(state.current));
    body.querySelectorAll('[data-dars-share-via]').forEach(btn =>
      btn.addEventListener('click', () => shareInviteVia(btn.getAttribute('data-dars-share-via'), state.current)));

    body.querySelectorAll('[data-dars-remind]').forEach(btn =>
      btn.addEventListener('click', () => remind(btn.getAttribute('data-dars-remind'), btn.getAttribute('data-session'))));

    body.querySelector('#dars-add-member-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = body.querySelector('#dars-member-email').value.trim();
      if (!email) return;
      try {
        const { group } = await window.api.addDarsMember(state.current.id, email);
        state.current = group;
        toast('Member added');
        render();
      } catch (err) { handleError(err, 'Could not add that person'); }
    });

    body.querySelectorAll('[data-remove-member]').forEach(btn =>
      btn.addEventListener('click', async () => {
        try {
          const { group } = await window.api.removeDarsMember(state.current.id, btn.getAttribute('data-remove-member'));
          state.current = group; render();
        } catch (err) { handleError(err, 'Could not remove that member'); }
      }));

    // Scheduler
    body.querySelector('.dars-scheduler')?.addEventListener('toggle', (e) => {
      state.schedOpen = e.currentTarget.open;
    });
    body.querySelectorAll('[data-day]').forEach(btn =>
      btn.addEventListener('click', () => {
        state.schedDay = btn.getAttribute('data-day');
        state.schedOpen = true;
        // Preserve any typed time/title before re-render.
        const t = body.querySelector('#dars-sched-time'); if (t) state.schedTime = t.value;
        render();
      }));
    body.querySelector('[data-dars-schedule-confirm]')?.addEventListener('click', (e) =>
      confirmSchedule(e.currentTarget.getAttribute('data-dars-schedule-confirm')));

    // Reminder settings
    body.querySelector('[data-dars-notify-toggle]')?.addEventListener('click', async () => {
      const g = state.current; if (!g) return;
      const next = !groupPrefs(g.id).notify;
      if (next) await ensureNotifyPermission();
      setGroupPrefs(g.id, { notify: next });
      applyReminderPrefs(g);
      toast(next ? 'Reminders on for this Dars' : 'Muted this Dars');
      render();
    });
    const minInput = body.querySelector('#dars-minutes-before');
    minInput?.addEventListener('change', async () => {
      const g = state.current; if (!g) return;
      let v = parseInt(minInput.value, 10);
      if (!Number.isFinite(v) || v <= 0) v = null;
      else v = Math.min(1440, v);
      if (v) await ensureNotifyPermission();
      setGroupPrefs(g.id, { minutesBefore: v });
      applyReminderPrefs(g);
      toast(v ? `Reminder set ${v} min before each lesson` : 'Advance reminder off');
      render();
    });
  }

  // Ask for notification permission the moment the user opts into reminders
  // (value is obvious then). Native goes through the push bridge; web uses
  // the Notification API so the advance local reminder can show a banner.
  async function ensureNotifyPermission() {
    try {
      if (window.reminders?.ensurePermission) { await window.reminders.ensurePermission(); return; }
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch {}
  }

  async function previewJoin(code) {
    state.loading = true; render();
    try {
      const { group } = await window.api.previewDarsInvite(code);
      state.joinCode = code;
      state.joinPreview = group;
      state.view = 'join';
    } catch (err) {
      handleError(err, 'That invite link is invalid');
      state.view = 'list';
    } finally {
      state.loading = false; render();
    }
  }

  async function confirmJoin(code) {
    try {
      const { group } = await window.api.joinDarsGroup(code);
      subscribeTopic(group.id);
      toast(`Joined ${group.name}`);
      state.joinPreview = null;
      location.hash = `dars/group/${group.id}`;
    } catch (err) { handleError(err, 'Could not join the group'); }
  }

  async function confirmSchedule(groupId) {
    if (!state.schedDay) { toast('Pick a day first'); return; }
    const time = body.querySelector('#dars-sched-time')?.value || '20:00';
    const title = body.querySelector('#dars-sched-title')?.value.trim() || undefined;
    const notify = !!body.querySelector('#dars-sched-notify')?.checked;
    const when = combineLocal(state.schedDay, time);
    if (when.getTime() <= Date.now()) { toast('Pick a time in the future'); return; }
    try {
      const { group } = await window.api.scheduleDars(groupId, { title, scheduledAt: when.toISOString(), notify });
      state.current = group;
      state.schedDay = null; state.schedTime = null; state.schedTitle = null; state.schedOpen = false;
      // Reschedule this member's advance reminders to include the new lesson.
      applyReminderPrefs(group);
      toast(notify ? 'Lesson scheduled · members notified' : 'Lesson scheduled');
      render();
    } catch (err) { handleError(err, 'Could not schedule the lesson'); }
  }

  async function remind(groupId, sessionId) {
    try {
      const res = await window.api.remindDars(groupId, sessionId ? { sessionId } : {});
      // The server tells us whether the push actually went out (FCM may be
      // disabled in dev), so the admin gets honest feedback.
      if (res?.delivery?.sent) toast('Reminder sent to everyone');
      else toast('Reminder queued (push is off in this environment)');
    } catch (err) { handleError(err, 'Could not send the reminder'); }
  }

  function goList() {
    if (location.hash.startsWith('#dars')) location.hash = 'dars';
    else { state.view = 'list'; render(); }
  }

  // ═══ Hash routing (owned by this module) ════════════════════════════
  function applyHash() {
    const hash = location.hash.replace(/^#/, '');
    if (!hash.startsWith('dars')) {
      if (drawer && drawer.getAttribute('aria-hidden') === 'false') close();
      return;
    }
    open();
    const rest = hash.slice('dars'.length).replace(/^\//, ''); // '', 'group/<id>', 'join/<code>'
    if (rest.startsWith('group/')) {
      const id = rest.slice('group/'.length);
      if (!state.current || state.current.id !== id) loadGroup(id);
      else { state.view = 'detail'; render(); }
    } else if (rest.startsWith('join/')) {
      const code = rest.slice('join/'.length).toLowerCase();
      if (!signedInEmail()) { state.view = 'list'; render(); toast('Sign in to accept the invite'); location.hash = 'login'; return; }
      state.view = 'join';
      if (state.joinCode !== code) { state.joinPreview = null; previewJoin(code); }
      else render();
    } else {
      state.view = 'list';
      loadGroups();
    }
  }

  // ─── Init ───────────────────────────────────────────────────────────
  function init() {
    drawer = document.getElementById('dars-drawer');
    body = document.getElementById('dars-body');
    backBtn = document.getElementById('dars-back');
    pill = document.getElementById('dars-pill');
    pillCount = document.getElementById('dars-pill-count');
    if (!drawer || !body) return;

    pill?.addEventListener('click', () => { location.hash = 'dars'; });
    backBtn?.addEventListener('click', () => goList());
    drawer.querySelectorAll('[data-close-dars]').forEach(el => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.getAttribute('aria-hidden') === 'false') close();
    });

    window.addEventListener('hashchange', applyHash);
    // Handle a share link opened cold (deep-link into a fresh load).
    applyHash();

    // Warm the pill count so the badge reflects membership on load, even
    // before the user opens the drawer. Best-effort; ignores auth failure.
    if (signedInEmail()) {
      window.api?.listDarsGroups?.().then(({ groups }) => {
        state.groups = groups || [];
        state.groups.forEach(g => applyReminderPrefs(g));
        updatePillCount();
      }).catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { open, close, applyHash, _state: state };
})();

window.dars = dars;
