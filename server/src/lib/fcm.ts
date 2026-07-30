// ═══════════════════════════════════════════════════════════════════
// Firebase Cloud Messaging — keeper-update push notifications.
//
// Server only sends. Topic subscription happens entirely client-side
// via FCM's subscribeToTopic — no token table, no migration.
//
// Topic format:  keeper-<keeperUserId>-mosque-<mosqueId>
// Why per-(keeper, masjid):  a user can follow keeper X at masjid A and
// keeper Y at masjid B; we only want to ping them when X submits *for A*.
//
// `FCM_ENABLED !== 'true'` makes this a logging-only no-op. The module
// stays safe to import in dev/staging where Firebase creds may be absent.
// ═══════════════════════════════════════════════════════════════════

import admin from 'firebase-admin';

const PRAYER_LABEL: Record<string, string> = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
  jummah: 'Jummah',
};

export interface ScheduleChange {
  prayer: string;
  action: string;
  reason: string;
  from?: string;
  to?: string;
}

export interface NotifyKeeperUpdateArgs {
  mosqueId: string;
  submitterId: string;
  submissionId: string;
  keeperName: string;
  mosqueName: string;
  timings: Record<string, unknown>;
  scheduleChanges: ScheduleChange[];
}

// What the caller learns about the push. `topic` is always populated so
// the route can log "we tried to ping <topic>" regardless of outcome.
// On success: { sent: true, messageId }. On any failure: { sent: false, reason }.
// Reasons are stable strings so log queries / dashboards can group them.
export type NotifyResult =
  | { topic: string; sent: true;  messageId: string }
  | { topic: string; sent: false; reason: 'disabled' | 'admin-not-initialized' | 'send-failed'; error?: string };

// 24h "HH:mm" → "H:MM AM/PM" with localized AM/PM. Keeps body readable.
// Accepts string OR string[] (jummah's `to` is an array of times after
// recomputeAndPromote — the type system lies, reality has arrays).
// Returns the original raw input on any malformed shape so the body
// never silently renders a fake time like "5:99 AM".
function fmt12(input: string | string[] | undefined): string {
  if (input == null) return '';
  // Unwrap [time, ...] → first time. Empty array → ''.
  const hhmm = Array.isArray(input) ? input[0] : input;
  if (typeof hhmm !== 'string' || hhmm === '') return '';
  // Minute portion is bounded to 0-59; the previous \d{2} let "5:99" pass.
  const m = hhmm.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return hhmm;
  let h = parseInt(m[1], 10);
  const mm = m[2];
  if (h < 0 || h > 23) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mm} ${period}`;
}

// Body content per the spec:
//   1 prayer (HH:mm):       "New <Prayer> at <H:MM AM/PM>"
//   1 maghribOffset:        "Maghrib offset updated to <N> min"
//   2 changes:              "Updated <X> (...) and <Y> (...)" with
//                           offset rendered as "Maghrib offset (+N min)"
//   3+ changes:             "Updated N prayer times"
function buildBody(changes: ScheduleChange[], timings: Record<string, unknown>): string {
  // Drop changes with no meaningful target time. The previous filter
  // (c.to !== undefined) let null/empty-string slip through, producing
  // bodies like "New Isha at " (trailing space, no time). Empty arrays
  // (jummah edge) are also filtered out here.
  const meaningful = changes.filter(c => {
    if (!c.prayer) return false;
    const to: unknown = c.to;
    if (to === undefined || to === null || to === '') return false;
    if (Array.isArray(to) && (to.length === 0 || to[0] === '' || to[0] == null)) return false;
    return true;
  });
  if (meaningful.length === 0) {
    // Submission with no schedule promotion — followers still want to know.
    return 'New jamat times posted';
  }
  // Render a single change with the right phrasing for the kind of value.
  const renderOne = (c: ScheduleChange): string => {
    if (c.prayer === 'maghribOffset') {
      // recomputeAndPromote stringifies the integer winner via String(N).
      // We strip non-digits defensively in case a future caller passes a number.
      const n = String(c.to ?? '').replace(/[^0-9-]/g, '');
      return `Maghrib offset updated to ${n} min`;
    }
    const label = PRAYER_LABEL[c.prayer] || c.prayer;
    const to = c.to ?? (typeof timings[c.prayer] === 'string' ? timings[c.prayer] as string : undefined);
    return `New ${label} at ${fmt12(to)}`;
  };
  // Render a single change as a value-only fragment for the 2-change body.
  // Offset uses the "+N min" form so the surrounding "Updated X and Y"
  // stays readable.
  const renderFragment = (c: ScheduleChange): string => {
    if (c.prayer === 'maghribOffset') {
      const n = String(c.to ?? '').replace(/[^0-9-]/g, '');
      return `Maghrib offset (+${n} min)`;
    }
    const label = PRAYER_LABEL[c.prayer] || c.prayer;
    return `${label} (${fmt12(c.to)})`;
  };
  if (meaningful.length === 1) {
    return renderOne(meaningful[0]);
  }
  if (meaningful.length === 2) {
    const [a, b] = meaningful;
    return `Updated ${renderFragment(a)} and ${renderFragment(b)}`;
  }
  return `Updated ${meaningful.length} prayer times`;
}

function topicName(keeperId: string, mosqueId: string): string {
  return `keeper-${keeperId}-mosque-${mosqueId}`;
}

// Per-user inbox topic. Only the keeper themselves subscribes (their
// device, on signin) so the only recipient is them — no fan-out.
// The user.id is a UUID; FCM topic names accept [a-zA-Z0-9-_.~%] up to
// 900 chars, so unprefixed UUIDs would technically work, but the prefix
// makes the intent self-documenting in admin logs.
function suggestTopicName(userId: string): string {
  return `suggest-to-${userId}`;
}

// Title looks like "<keeperName> updated <mosqueName>". This helper guards
// against three sharp edges from the call site:
//   - whitespace bleed: leading/trailing spaces on either name leak into
//     the title (" updated Mujaddiya Masjid" with a leading space)
//   - empty/whitespace-only names: the submissions route already falls
//     back to "A time keeper"/"a masjid" via `keeper?.fullName || ...`,
//     but defensive trimming here means callers can pass a raw DB value
//     without normalizing first
//   - oversized inputs: FCM's notification.title is capped at ~200 chars
//     and Android only renders ~50 chars in the collapsed banner anyway.
//     Truncate aggressively rather than have FCM reject the whole send.
const TITLE_MAX = 180;            // FCM cap is ~200; leave headroom for ellipsis + ": updated "
const NAME_MAX  = 80;             // half the budget per side
function composeTitle(keeperName: string, mosqueName: string): string {
  const trim = (s: string): string => (typeof s === 'string' ? s.trim() : '');
  const cap  = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1) + '…');
  const k = cap(trim(keeperName), NAME_MAX);
  const m = cap(trim(mosqueName), NAME_MAX);
  // Collapse degenerate cases. The submissions/admin routes apply
  // their own fallbacks, but if both arrive empty here we still want
  // something readable rather than " updated " or "undefined updated".
  if (k && m) return cap(`${k} updated ${m}`, TITLE_MAX);
  if (k && !m) return cap(`${k} posted new times`, TITLE_MAX);
  if (!k && m) return cap(`New times for ${m}`, TITLE_MAX);
  return 'New jamat times posted';
}

// ─── notifyOnSuggest ────────────────────────────────────────────────
// Push to the keeper's device when someone sends them a new suggestion
// (POST /api/suggestions). Without this the keeper has no idea a
// suggestion landed until they happen to open the app — the inbox bell
// only refreshes on init/foreground, not on a server-side event.
//
// Topic:  suggest-to-<userId>  (only the keeper subscribes)
// Title:  "<from> suggests new times for <mosque>"
// Body:   per-prayer summary using the same fmt12 + filtering logic as
//         keeper-updates, but with "Suggests" verb instead of "Updated".
// Tap:    foreground -> refresh inbox; background -> deep-link #inbox
//         (handled in mobile/native-bridge.js push listeners).

export interface NotifyOnSuggestArgs {
  suggestionId: string;
  toUserId: string;
  mosqueId: string;
  fromUserName: string;
  mosqueName: string;
  timings: Record<string, unknown>;
  notes?: string;
}

// Title: "<from> suggests new times for <mosque>". Trim/cap rules
// mirror composeTitle so a 200-char DB name can't blow the FCM cap.
function composeSuggestTitle(fromName: string, mosqueName: string): string {
  const trim = (s: string): string => (typeof s === 'string' ? s.trim() : '');
  const cap  = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1) + '…');
  const f = cap(trim(fromName), NAME_MAX);
  const m = cap(trim(mosqueName), NAME_MAX);
  if (f && m) return cap(`${f} suggests new times for ${m}`, TITLE_MAX);
  if (f && !m) return cap(`${f} suggests new times`, TITLE_MAX);
  if (!f && m) return cap(`New suggestion for ${m}`, TITLE_MAX);
  return 'New suggestion in your inbox';
}

// Body: render the suggested values. Reuse the same per-prayer phrasing
// as buildBody by synthesizing ScheduleChange entries from the timings
// object. For a brand-new suggestion we don't know the previous values,
// so `from` is left undefined — the "Suggests Fajr (4:30 AM)" copy
// reads naturally without a from→to comparison.
function buildSuggestBody(timings: Record<string, unknown>): string {
  const PRAYERS = ['fajr', 'dhuhr', 'asr', 'isha', 'jummah'];
  const meaningful: ScheduleChange[] = [];
  for (const p of PRAYERS) {
    const v = timings[p];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && (v.length === 0 || v[0] === '' || v[0] == null)) continue;
    meaningful.push({ prayer: p, action: 'suggested', reason: '', to: v as string | string[] as any });
  }
  // maghribOffset only counts when caller explicitly suggested one.
  const off = timings.maghribOffset;
  if (off !== undefined && off !== null && off !== '') {
    meaningful.push({ prayer: 'maghribOffset', action: 'suggested', reason: '', to: String(off) });
  }
  if (meaningful.length === 0) return 'New suggestion in your inbox';
  if (meaningful.length === 1) {
    const c = meaningful[0];
    if (c.prayer === 'maghribOffset') {
      const n = String(c.to ?? '').replace(/[^0-9-]/g, '');
      return `Suggests Maghrib offset of ${n} min`;
    }
    return `Suggests ${PRAYER_LABEL[c.prayer] || c.prayer} at ${fmt12(c.to as any)}`;
  }
  if (meaningful.length === 2) {
    const fragOf = (c: ScheduleChange) => {
      if (c.prayer === 'maghribOffset') {
        const n = String(c.to ?? '').replace(/[^0-9-]/g, '');
        return `Maghrib offset (+${n} min)`;
      }
      return `${PRAYER_LABEL[c.prayer] || c.prayer} (${fmt12(c.to as any)})`;
    };
    return `Suggests ${fragOf(meaningful[0])} and ${fragOf(meaningful[1])}`;
  }
  return `Suggests ${meaningful.length} prayer time changes`;
}

export async function notifyOnSuggest(args: NotifyOnSuggestArgs): Promise<NotifyResult> {
  const enabled = process.env.FCM_ENABLED === 'true';
  const topic = suggestTopicName(args.toUserId);
  const title = composeSuggestTitle(args.fromUserName, args.mosqueName);
  const body = buildSuggestBody(args.timings);

  // FCM message. `data` MUST be a flat object of strings — FCM enforces.
  // Type 'new_suggestion' is the discriminator the client uses to route
  // to the inbox refresh handler vs. the schedule-update handler.
  const message = {
    topic,
    notification: { title, body },
    data: {
      type:         'new_suggestion',
      suggestionId: args.suggestionId,
      mosqueId:     args.mosqueId,
      ts:           new Date().toISOString(),
    },
    android: {
      priority: 'high' as const,
      notification: {
        channelId: 'keeper-updates', // reuse the existing channel
        // Tag by suggestionId so two pings from the same person don't
        // stack (a re-send replaces the prior banner).
        tag: args.suggestionId,
      },
    },
  };

  if (!enabled) {
    // eslint-disable-next-line no-console
    console.info('[fcm] FCM_ENABLED!=true — would have sent suggest:', { topic, title, body, data: message.data });
    return { topic, sent: false, reason: 'disabled' };
  }
  if (!admin.apps.length) {
    // eslint-disable-next-line no-console
    console.warn('[fcm] firebase-admin not initialized; skipping suggest send', { topic });
    return { topic, sent: false, reason: 'admin-not-initialized' };
  }
  try {
    const messageId = await admin.messaging().send(message);
    // eslint-disable-next-line no-console
    console.info('[fcm] sent suggest', { topic, messageId, title });
    return { topic, sent: true, messageId };
  } catch (err) {
    const error = (err as Error).message;
    // eslint-disable-next-line no-console
    console.error('[fcm] suggest send failed', { topic, err: error });
    return { topic, sent: false, reason: 'send-failed', error };
  }
}

// ─── notifyDarsGroup ────────────────────────────────────────────────
// Fan-out push to every member of a Dars study circle. The group IS an
// FCM topic (`dars-group-<id>`) that members' devices subscribe to on
// join, so one send reaches all of them — no device-token table, no
// per-member loop. Two triggers use this:
//   - kind 'reminder':  the admin taps the "Remind" button ("Dars is
//                       about to start — come join").
//   - kind 'scheduled': the admin schedules a new session (optional
//                       heads-up so members can plan).
// Tap routing is handled client-side: data.type 'dars_reminder' deep-links
// to the in-app Dars screen (mobile/native-bridge.js push listeners).

function darsTopicName(groupId: string): string {
  return `dars-group-${groupId}`;
}

export interface NotifyDarsGroupArgs {
  groupId: string;
  groupName: string;
  kind: 'reminder' | 'scheduled';
  // Free-text line from the admin, or the session title. Optional.
  message?: string;
  // ISO time of the session this ping refers to, if any.
  sessionAt?: string;
}

function composeDarsTitle(groupName: string, kind: 'reminder' | 'scheduled'): string {
  const trim = (s: string): string => (typeof s === 'string' ? s.trim() : '');
  const cap = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1) + '…');
  const g = cap(trim(groupName), NAME_MAX) || 'Your Dars group';
  return kind === 'scheduled'
    ? cap(`New Dars scheduled — ${g}`, TITLE_MAX)
    : cap(`Dars reminder — ${g}`, TITLE_MAX);
}

function composeDarsBody(args: NotifyDarsGroupArgs): string {
  const trim = (s?: string): string => (typeof s === 'string' ? s.trim() : '');
  const custom = trim(args.message);
  if (custom) return custom.length <= 300 ? custom : custom.slice(0, 299) + '…';
  if (args.sessionAt) {
    const d = new Date(args.sessionAt);
    if (!Number.isNaN(d.getTime())) {
      // Render a readable local-ish stamp; the client re-formats precisely.
      const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const pretty = fmt12(hhmm);
      return args.kind === 'scheduled'
        ? `A new Dars is scheduled for ${pretty}. Tap to see details.`
        : `Dars is starting around ${pretty}. Come and join.`;
    }
  }
  return args.kind === 'scheduled'
    ? 'A new Dars has been scheduled. Tap to see details.'
    : 'Your Dars is about to start. Come and join.';
}

export async function notifyDarsGroup(args: NotifyDarsGroupArgs): Promise<NotifyResult> {
  const enabled = process.env.FCM_ENABLED === 'true';
  const topic = darsTopicName(args.groupId);
  const title = composeDarsTitle(args.groupName, args.kind);
  const body = composeDarsBody(args);

  const message = {
    topic,
    notification: { title, body },
    data: {
      type:    'dars_reminder',
      groupId: args.groupId,
      kind:    args.kind,
      ts:      new Date().toISOString(),
    },
    android: {
      priority: 'high' as const,
      notification: {
        // Dedicated Dars channel carrying the custom prayer_chime sound; the
        // client creates it as 'dars-reminders-v1'. Mirror the sound at the
        // message level too (belt-and-braces for the Android plugin).
        channelId: 'dars-reminders-v1',
        sound:     'prayer_chime',
        tag:       `dars-${args.groupId}`,
      },
    },
  };

  if (!enabled) {
    // eslint-disable-next-line no-console
    console.info('[fcm] FCM_ENABLED!=true — would have sent dars:', { topic, title, body, data: message.data });
    return { topic, sent: false, reason: 'disabled' };
  }
  if (!admin.apps.length) {
    // eslint-disable-next-line no-console
    console.warn('[fcm] firebase-admin not initialized; skipping dars send', { topic });
    return { topic, sent: false, reason: 'admin-not-initialized' };
  }
  try {
    const messageId = await admin.messaging().send(message);
    // eslint-disable-next-line no-console
    console.info('[fcm] sent dars', { topic, messageId, title });
    return { topic, sent: true, messageId };
  } catch (err) {
    const error = (err as Error).message;
    // eslint-disable-next-line no-console
    console.error('[fcm] dars send failed', { topic, err: error });
    return { topic, sent: false, reason: 'send-failed', error };
  }
}

export async function notifyKeeperUpdate(args: NotifyKeeperUpdateArgs): Promise<NotifyResult> {
  const enabled = process.env.FCM_ENABLED === 'true';
  const topic = topicName(args.submitterId, args.mosqueId);
  const body = buildBody(args.scheduleChanges, args.timings);
  const title = composeTitle(args.keeperName, args.mosqueName);

  // FCM message. Note `data` MUST be a flat object of strings — FCM enforces.
  const message = {
    topic,
    notification: { title, body },
    data: {
      type:         'schedule_update',
      mosqueId:     args.mosqueId,
      submitterId:  args.submitterId,
      submissionId: args.submissionId,
      ts:           new Date().toISOString(),
    },
    android: {
      priority: 'high' as const,
      notification: {
        channelId: 'keeper-updates',
        tag:       args.mosqueId,
      },
    },
  };

  if (!enabled) {
    // eslint-disable-next-line no-console
    console.info('[fcm] FCM_ENABLED!=true — would have sent:', { topic, title, body, data: message.data });
    return { topic, sent: false, reason: 'disabled' };
  }

  if (!admin.apps.length) {
    // eslint-disable-next-line no-console
    console.warn('[fcm] firebase-admin not initialized; skipping send', { topic });
    return { topic, sent: false, reason: 'admin-not-initialized' };
  }

  // Catch-all so a transient FCM outage never propagates to the user's
  // POST /submissions response. The spec is explicit: fire-and-forget.
  try {
    const messageId = await admin.messaging().send(message);
    // eslint-disable-next-line no-console
    console.info('[fcm] sent', { topic, messageId, title });
    return { topic, sent: true, messageId };
  } catch (err) {
    const error = (err as Error).message;
    // eslint-disable-next-line no-console
    console.error('[fcm] send failed', { topic, err: error });
    return { topic, sent: false, reason: 'send-failed', error };
  }
}
