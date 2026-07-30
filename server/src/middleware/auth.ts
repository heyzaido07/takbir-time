import { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';
import { prisma } from '../lib/prisma';
import { trackAuthenticatedRequest } from '../lib/activity';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!process.env.FIREBASE_PROJECT_ID || !privateKey || !process.env.FIREBASE_CLIENT_EMAIL) {
    console.warn('⚠️  Firebase credentials not configured. Auth will not work.');
  } else {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: privateKey,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
      })
    });
    console.log('✅ Firebase Admin SDK initialized');
  }
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        firebaseUid: string;
      };
    }
  }
}

/**
 * Dev-only bypass. Two modes (only active outside production when
 * DEV_AUTH_USER_EMAIL is set):
 *  1. Per-request: client sends `X-Dev-User-Email: someone@example.com`. The
 *     user is created on first request — this is how the frontend "login"
 *     flow identifies a user without Firebase.
 *  2. Fallback: if the header is absent, every request is treated as the
 *     env-var user (the seeded demo).
 * Never set DEV_AUTH_USER_EMAIL in production.
 */
async function devAuthBypass(req: Request): Promise<boolean> {
  // If the client sent a real Bearer token (our app JWT or a Firebase ID
  // token), the explicit credential ALWAYS wins over any bypass.
  // This is defense-in-depth against a production foot-gun: if
  // DEV_AUTH_USER_EMAIL accidentally leaks into the prod environment,
  // every authenticated request would otherwise be silently re-attributed
  // to the env-var user — the bypass runs before the Bearer-token branch
  // in `authenticate`. Yielding here ensures real auth always takes
  // precedence; bypasses are opt-in for anonymous (no-token) calls.
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return false;

  // In test runs we force real auth checks (so 401 assertions can fire),
  // BUT we also accept an explicit X-Test-User-Id header that lets a test
  // act as a specific seeded user without going through Firebase.
  if (process.env.NODE_ENV === 'test') {
    const testUserId = (req.headers['x-test-user-id'] as string | undefined)?.trim();
    if (!testUserId) return false;
    const u = await prisma.user.findUnique({ where: { id: testUserId } });
    if (!u) return false;
    if (u.deletedAt) throw new AppError(401, 'Account has been deleted');
    req.user = { id: u.id, email: u.email, firebaseUid: u.firebaseUid ?? `test:${u.id}` };
    return true;
  }
  if (process.env.NODE_ENV === 'production') return false;
  if (!process.env.DEV_AUTH_USER_EMAIL) return false;

  const headerEmail = (req.headers['x-dev-user-email'] as string | undefined)?.trim().toLowerCase();
  const email = headerEmail || process.env.DEV_AUTH_USER_EMAIL;

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    if (headerEmail) {
      // First sign-in for this email — create the user on the fly.
      user = await prisma.user.create({
        data: { email, fullName: email.split('@')[0] },
      });
    } else {
      throw new AppError(500, `DEV_AUTH_USER_EMAIL=${email} but no such user in DB`);
    }
  }
  if (user.deletedAt) throw new AppError(401, 'Account has been deleted');

  req.user = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid ?? `dev:${user.id}`,
  };
  return true;
}

// Distinguish our app-issued JWT from a Firebase ID token without
// running the (slow, network-bound) Firebase verify on every request.
// jwt.decode is sync and DOES NOT verify the signature — it just parses
// the JSON, which is enough to read the issuer and route to the right
// verifier. The actual verify happens in the matching branch below.
function isOurAppJwt(token: string): boolean {
  try {
    const decoded = jwt.decode(token);
    return !!(decoded && typeof decoded === 'object' && (decoded as any).iss === 'takbeer-time');
  } catch {
    return false;
  }
}

async function userFromAppJwt(token: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AppError(500, 'Server misconfigured: JWT_SECRET unset');
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret) as jwt.JwtPayload;
  } catch (e: any) {
    if (e?.name === 'TokenExpiredError') throw new AppError(401, 'Authentication token expired');
    throw new AppError(401, 'Invalid authentication token');
  }
  const userId = payload.sub;
  if (!userId || typeof userId !== 'string') throw new AppError(401, 'Invalid authentication token');
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) throw new AppError(401, 'Authentication failed');
  // Reject tokens issued before the user soft-deleted their account.
  // Without this check, a previously-issued 30d JWT keeps working until
  // expiry — letting a deleted user keep posting submissions / fetching
  // private data. See routes/users.ts DELETE /me for the soft-delete flow.
  if (u.deletedAt) throw new AppError(401, 'Account has been deleted');
  return u;
}

/**
 * Verify the bearer token and attach user to request. Accepts:
 *  - our app JWT (issued by /api/auth/{register,login,google}) — fastest path
 *  - Firebase ID token (for clients that haven't migrated to /auth/google)
 *  - dev-auth fallback (X-Dev-User-Email header, gated by env)
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (await devAuthBypass(req)) {
      trackAuthenticatedRequest(req);
      return next();
    }

    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'No authentication token provided');
    }

    const idToken = authHeader.split('Bearer ')[1];

    // Fast path: our own JWT.
    if (isOurAppJwt(idToken)) {
      const u = await userFromAppJwt(idToken);
      // last_login_at is updated on each /auth/login response; not on
      // every authenticated request (write amplification).
      req.user = { id: u.id, email: u.email, firebaseUid: u.firebaseUid ?? `app:${u.id}` };
      trackAuthenticatedRequest(req);
      return next();
    }

    // Slow path: Firebase ID token (for clients still sending raw
    // Firebase tokens directly instead of going through /auth/google).
    // Verify token with Firebase
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const firebaseUid = decodedToken.uid;
    const email = decodedToken.email;

    if (!email) {
      throw new AppError(401, 'Email not found in token');
    }

    // Find or create user in database
    let user = await prisma.user.findUnique({
      where: { firebaseUid }
    });

    if (!user) {
      // Create new user on first sign-in
      user = await prisma.user.create({
        data: {
          firebaseUid,
          email,
          fullName: decodedToken.name || null,
          lastLoginAt: new Date()
        }
      });
      console.log(`✨ New user created: ${email}`);
    } else {
      if (user.deletedAt) throw new AppError(401, 'Account has been deleted');
      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      firebaseUid: user.firebaseUid!
    };

    trackAuthenticatedRequest(req);
    next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }

    // Firebase auth errors
    if (error instanceof Error) {
      if (error.message.includes('expired')) {
        return next(new AppError(401, 'Authentication token expired'));
      }
      if (error.message.includes('invalid')) {
        return next(new AppError(401, 'Invalid authentication token'));
      }
    }

    return next(new AppError(401, 'Authentication failed'));
  }
};

/**
 * Optional authentication - attach user if token present, but don't require it.
 *
 * Critical: this MUST swallow auth failures (invalid token, expired token,
 * network error talking to Firebase) and call next() with no error, so the
 * underlying public route still serves the response. Earlier versions
 * delegated to `authenticate(req, res, next)` — but `authenticate` calls
 * `next(error)` on its own error path, and that NEVER throws; once the
 * delegated `next` is invoked Express moves to the error handler and the
 * try/catch here can't intercept it. So we replicate the verify logic
 * inline and just return next() on any failure.
 */
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (await devAuthBypass(req)) return next();
  } catch {
    // Dev-bypass deciding to throw (e.g. deleted user with X-Test-User-Id)
    // is not a fatal error for a public read — fall through to anonymous.
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    if (isOurAppJwt(idToken)) {
      const u = await userFromAppJwt(idToken);
      req.user = { id: u.id, email: u.email, firebaseUid: u.firebaseUid ?? `app:${u.id}` };
      return next();
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const firebaseUid = decodedToken.uid;
    const email = decodedToken.email;
    if (!email) return next();

    const user = await prisma.user.findUnique({ where: { firebaseUid } });
    // Don't auto-create users from optional-auth — only `authenticate`
    // should ever materialize a row, because that's the explicit sign-in
    // surface. Optional-auth is a "nice to know who's reading" path.
    if (!user || user.deletedAt) return next();
    req.user = { id: user.id, email: user.email, firebaseUid: user.firebaseUid! };
    return next();
  } catch {
    // Any verify or DB failure → treat as anonymous. Public reads must
    // not 401 just because a stale token is hanging around in the client.
    return next();
  }
};
