// ─────────────────────────────────────────────────────────────────────
// Email/password + Google sign-in. Three entry points:
//
//   POST /api/auth/register  - email + password → new User + our JWT
//   POST /api/auth/login     - email + password → existing user + our JWT
//   POST /api/auth/google    - Firebase ID token → find/create user + our JWT
//
// All three return the same { token, user } shape so the client only
// needs one storage path. The client stores `token` and sends it as
// `Authorization: Bearer <token>` on every subsequent request — same
// header that already worked for raw Firebase ID tokens, but our
// middleware now accepts both shapes (see middleware/auth.ts).
//
// Why issue our own JWT instead of just letting the client send the
// Firebase ID token directly?
//   - Email/password users have no Firebase identity, so they need a
//     bearer token of *some* kind.
//   - Unifying both paths under one token format keeps the client and
//     middleware simple — only one verify step.
//   - Firebase ID tokens expire every hour; rotating them client-side
//     is its own mini-feature. Our JWT default is 30d so the user
//     stays signed in across casual app restarts.
// ─────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';
import { prisma } from '../lib/prisma';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { loginLimiter, registerLimiter, googleAuthLimiter } from '../middleware/rateLimit';
import { trackUserActivity } from '../lib/activity';

const router = Router();

const BCRYPT_COST = 12;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new AppError(500, 'Server misconfigured: JWT_SECRET must be set (>=32 chars)');
  }
  return s;
}

// What we sign. `sub` is the userId (UUID). `iss` lets the middleware
// distinguish our JWTs from Firebase ID tokens (which carry
// iss=https://securetoken.google.com/<projectId>) — see middleware/auth.ts.
export interface AppJwtPayload {
  sub: string;       // user.id
  email: string;
  iss: 'takbeer-time';
  iat?: number;
  exp?: number;
}

function issueToken(user: { id: string; email: string }): string {
  const payload: AppJwtPayload = { sub: user.id, email: user.email, iss: 'takbeer-time' };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

// Shared response shape so the client has a stable contract regardless
// of which auth method the user picked.
function authResponse(user: { id: string; email: string; fullName: string | null; firebaseUid: string | null }) {
  return {
    token: issueToken(user),
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      hasGoogleAuth: !!user.firebaseUid,
    },
  };
}

// ─── Register ─────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  fullName: z.string().trim().min(1).max(255).optional(),
});

router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, `Validation Error: ${parsed.error.issues.map(i => i.message).join('; ')}`);
    }
    const { email, password, fullName } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Three "already exists" cases all 409 with the same message so
      // the response can't be used as an account-state oracle:
      //
      //   1. existing.passwordHash       — already claimed via password.
      //   2. existing.deletedAt          — soft-deleted; let support
      //                                    handle restoration, never the
      //                                    /register endpoint.
      //   3. existing.firebaseUid        — claimed via Google sign-in.
      //                                    CRITICAL: without this guard,
      //                                    anyone who knows a Google-
      //                                    only user's email could call
      //                                    /register with a chosen
      //                                    password and the row's
      //                                    passwordHash would be set,
      //                                    handing over the account on
      //                                    a plate. Existing column
      //                                    population (firebaseUid set
      //                                    + passwordHash null) is
      //                                    exactly the Google-only
      //                                    shape, so this gate has zero
      //                                    false positives for legit
      //                                    claim flow (dev-auth users
      //                                    have BOTH null and remain
      //                                    eligible to claim).
      if (existing.passwordHash || existing.deletedAt || existing.firebaseUid) {
        throw new AppError(409, 'An account with that email already exists');
      }
      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      const user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          fullName: fullName ?? existing.fullName,
          lastLoginAt: new Date(),
        },
      });
      trackUserActivity(req, user.id, 'auth_register_claimed', { provider: 'password' });
      return res.status(200).json(authResponse(user));
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: fullName ?? email.split('@')[0],
        lastLoginAt: new Date(),
      },
    });
    trackUserActivity(req, user.id, 'auth_register_created', { provider: 'password' });
    res.status(201).json(authResponse(user));
  })
);

// ─── Login ────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(200),
});

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Email and password are required');
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    // Constant-ish error message (and a dummy bcrypt compare to keep the
    // timing similar) so an attacker can't enumerate which emails exist.
    // Soft-deleted accounts are also rejected with the same message —
    // we don't want sign-in to confirm "this account exists but was
    // deleted" because that's still account enumeration.
    const dummyHash = '$2b$12$oN.CZSi.tMG2TgDc/OeXdulcL98wDDmoXl.ZADb./FmL2c1nTdsfa';
    if (!user || !user.passwordHash || user.deletedAt) {
      await bcrypt.compare(password, dummyHash);
      throw new AppError(401, 'Invalid email or password');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new AppError(401, 'Invalid email or password');

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    trackUserActivity(req, user.id, 'auth_login', { provider: 'password' });

    res.json(authResponse(user));
  })
);

// ─── Google sign-in ───────────────────────────────────────────────────
// Client gets a Firebase ID token (web: signInWithPopup; mobile:
// @capacitor-firebase/authentication's signInWithGoogle) and posts it
// here. Server verifies via firebase-admin, then finds-or-creates a
// User row matched by firebaseUid first, then by email (so existing
// dev-auth-only users are upgraded in place rather than getting a
// duplicate row).

const googleSchema = z.object({
  idToken: z.string().min(1),
});

router.post(
  '/google',
  googleAuthLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = googleSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'idToken is required');

    if (!admin.apps.length) {
      throw new AppError(500, 'Server misconfigured: firebase-admin not initialized');
    }
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await admin.auth().verifyIdToken(parsed.data.idToken);
    } catch (err) {
      throw new AppError(401, 'Google sign-in failed: invalid token');
    }
    const email = decoded.email?.trim().toLowerCase();
    if (!email) throw new AppError(401, 'Google sign-in failed: token has no email');
    const firebaseUid = decoded.uid;
    const fullName = decoded.name ?? null;

    // Find by firebaseUid first (returning Google user). Then by email
    // (existing dev-auth user upgrading to Google) — link the firebaseUid
    // onto the existing row to merge identities.
    let user = await prisma.user.findUnique({ where: { firebaseUid } });
    if (!user) {
      const byEmail = await prisma.user.findUnique({ where: { email } });
      if (byEmail) {
        if (byEmail.deletedAt) {
          throw new AppError(401, 'This account has been deleted. Please contact support to restore it.');
        }
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            firebaseUid,
            fullName: byEmail.fullName ?? fullName,
            emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
            lastLoginAt: new Date(),
          },
        });
        trackUserActivity(req, user.id, 'auth_google_linked', { provider: 'google' });
      } else {
        user = await prisma.user.create({
          data: {
            email,
            firebaseUid,
            fullName,
            emailVerifiedAt: new Date(),
            lastLoginAt: new Date(),
          },
        });
        trackUserActivity(req, user.id, 'auth_google_created', { provider: 'google' });
      }
    } else {
      if (user.deletedAt) {
        throw new AppError(401, 'This account has been deleted. Please contact support to restore it.');
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      trackUserActivity(req, user.id, 'auth_google_login', { provider: 'google' });
    }

    res.json(authResponse(user));
  })
);

export default router;
