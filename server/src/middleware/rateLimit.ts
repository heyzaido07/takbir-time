// Per-user rate limiting on write endpoints. The cap is read from env so
// tests can pin tiny values without simulating thousands of requests, and
// ops can dial it up/down without a redeploy.
//
// Keying: prefer the authenticated user id (stable across IPs, defeats
// IP-rotation abuse). Fall back to the source IP when the route is open
// to anonymous callers — better than no key at all.
//
// In-memory store is fine for a single-instance backend; behind a load
// balancer with multiple instances we'd need a Redis store.

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';

// IPv6-safe IP key. Raw req.ip on IPv6 yields a /128 (one address per
// global ID), and an attacker with a single /64 prefix has 2^64 unique
// IPs → trivially bypasses any per-IP rate limit. ipKeyGenerator from
// express-rate-limit groups IPv6 into /64 blocks so the limit applies
// to the whole prefix; IPv4 is returned unchanged. Required since
// express-rate-limit v7 logs ERR_ERL_KEY_GEN_IPV6 when raw IPs are
// returned from the keyGenerator.
function userOrIp(req: Request): string {
  if (req.user?.id) return req.user.id;
  return req.ip ? ipKeyGenerator(req.ip) : 'anon';
}
function ipOnly(req: Request): string {
  return req.ip ? ipKeyGenerator(req.ip) : 'anon';
}

function intEnv(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const HOUR = 60 * 60 * 1000;

// One factory, four named limiters. Each route mounts the relevant one.
export const submissionsLimiter = rateLimit({
  windowMs: HOUR,
  // Default 30/hr — a user submitting timings for >30 mosques in an hour
  // is almost certainly a script, not a real worshipper.
  max: () => intEnv('RATE_LIMIT_SUBMISSIONS_PER_HOUR', 30),
  keyGenerator: userOrIp,
  message: { error: 'Too many submissions. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const suggestionsLimiter = rateLimit({
  windowMs: HOUR,
  // Suggestions are higher-friction (one keeper has to act on each), so
  // be stricter — 10/hr keeps a single user from flooding a keeper's inbox.
  max: () => intEnv('RATE_LIMIT_SUGGESTIONS_PER_HOUR', 10),
  keyGenerator: userOrIp,
  message: { error: 'Too many suggestions. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Dars reminder sends fan out a push to every group member, so they're the
// spammiest single action in the app. Cap hard — 12/hr is plenty for a
// legitimate admin nudging a class, tight enough that a compromised admin
// can't machine-gun a group's devices.
export const darsRemindLimiter = rateLimit({
  windowMs: HOUR,
  max: () => intEnv('RATE_LIMIT_DARS_REMIND_PER_HOUR', 12),
  keyGenerator: userOrIp,
  message: { error: 'Too many reminders sent. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const votesLimiter = rateLimit({
  windowMs: HOUR,
  // Voting is cheap per-action but easy to brigade. 60/hr ≈ 1 every minute,
  // plenty for genuine browsing, capped tight enough to spot scripts.
  max: () => intEnv('RATE_LIMIT_VOTES_PER_HOUR', 60),
  keyGenerator: userOrIp,
  message: { error: 'Too many votes. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const mosquesCreateLimiter = rateLimit({
  windowMs: HOUR,
  // Creating mosques should be rare. 5/hr is enough for a power user adding
  // a few in a sitting, low enough to slow directory pollution scripts.
  max: () => intEnv('RATE_LIMIT_MOSQUES_PER_HOUR', 5),
  keyGenerator: userOrIp,
  message: { error: 'Too many mosques created. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const geocodeLimiter = rateLimit({
  windowMs: HOUR,
  // Pin reverse-geocoding runs from a human add-masjid flow. 120/hr leaves
  // room for dragging/adjusting while still protecting the public proxy.
  max: () => intEnv('RATE_LIMIT_GEOCODE_PER_HOUR', 120),
  keyGenerator: ipOnly,
  message: { error: 'Too many location lookups. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Auth limiters ────────────────────────────────────────────────────
// Auth endpoints are anonymous (no req.user yet), so the key is per-IP
// only. Email-based keying would invite "submit different email each
// request" abuse — IP is the right axis for credential-stuffing /
// brute-force / signup-flood patterns.
//
// We expose the same generic message ("Too many requests…") for register,
// login, and google so an attacker can't tell which endpoint they're
// being limited on (which would itself be a small enumeration signal).
const FIFTEEN_MIN = 15 * 60 * 1000;

// (ipOnly moved to top of file with IPv6-safe ipKeyGenerator wrapping)

// Login: brute-force is the threat. 10 attempts / 15min / IP.
export const loginLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: () => intEnv('RATE_LIMIT_LOGIN_PER_15MIN', 10),
  keyGenerator: ipOnly,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Register: signup flood / fake-account creation is the threat. Lower
// cap because legitimate users register once.
export const registerLimiter = rateLimit({
  windowMs: HOUR,
  max: () => intEnv('RATE_LIMIT_REGISTER_PER_HOUR', 5),
  keyGenerator: ipOnly,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Google sign-in: same pattern as login, but the work is heavier
// (Firebase verify round-trip). Cap below login since legitimate clients
// only need 1 successful exchange and then carry the app JWT.
export const googleAuthLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: () => intEnv('RATE_LIMIT_GOOGLE_PER_15MIN', 20),
  keyGenerator: ipOnly,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
