// ─────────────────────────────────────────────────────────────────────
// Public account-deletion request endpoint.
//
// Google Play (and the GDPR right-to-erasure) require us to expose a
// way for users who can no longer access the app to request account
// deletion. We can't expose a self-serve auth-less DELETE — anyone
// could wipe anyone else's account by typing their email — so this
// endpoint instead enqueues a request that a human reviews. The
// review step manually verifies ownership (typically a reply to the
// requester confirming intent) before triggering the same soft-delete
// flow as the in-app DELETE /api/users/me.
//
// Two safety properties beyond rate-limiting:
//   1. The response is identical regardless of whether the email
//      matches a real account. This prevents the form from being
//      used as an account-enumeration oracle.
//   2. The rate-limit is *per email* with a 1-hour window — that
//      stops a malicious actor from filling our review queue with
//      forged requests for someone else's email. (The standard
//      per-IP limiter would be bypassed by IP rotation; per-email
//      is the right key for this specific abuse case.)
// ─────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const submitSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  reason: z.string().trim().max(2000).optional(),
});

const ONE_HOUR_MS = 60 * 60 * 1000;

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'A valid email is required');
    }
    const { email, reason } = parsed.data;

    // Per-email rate limit: at most 1 pending request per hour. Returning
    // 429 here intentionally reveals "this email submitted recently" — that
    // information is no help to an attacker enumerating accounts because
    // the endpoint accepts any email shape, including ones that don't
    // exist. So all 429 tells you is "someone (you, an attacker, or the
    // real owner) submitted a form against this email recently."
    const cutoff = new Date(Date.now() - ONE_HOUR_MS);
    const recent = await prisma.accountDeletionRequest.count({
      where: { email, createdAt: { gte: cutoff } },
    });
    if (recent > 0) {
      return res.status(429).json({
        error: "You've already submitted a request for that email recently. Please wait an hour and try again, or email qazi.junaid@gmail.com.",
      });
    }

    // Capture IP + UA for the human reviewer — useful when the same
    // email gets repeated requests from different sources (which is
    // a signal the request is suspicious, not legitimate).
    const ipAddress = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      || req.ip
      || null;
    const userAgent = (req.headers['user-agent'] as string | undefined) || null;

    await prisma.accountDeletionRequest.create({
      data: {
        email,
        reason: reason || null,
        ipAddress,
        userAgent,
        status: 'pending',
      },
    });

    // Identical response shape regardless of whether the email matched.
    // We deliberately do NOT include {received: true, accountExists: ...}
    // or anything else that would let the form be used as an enumeration
    // oracle. Front-end shows a generic confirmation either way.
    res.status(202).json({ received: true });
  })
);

export default router;
