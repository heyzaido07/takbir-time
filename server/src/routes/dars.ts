// ═══════════════════════════════════════════════════════════════════
// Dars groups — small study circles with an admin, a shareable join code,
// scheduled lessons, and a fan-out "remind everyone" push.
//
// Fan-out model: each group maps to an FCM topic `dars-group-<id>` that
// members' devices subscribe to on join (client-side, mobile/native-bridge).
// The admin's "remind" send targets the topic → all members get the push.
// No device-token table, mirroring the keeper-follow design.
//
// Authorization:
//   - create:               any signed-in user (becomes admin + member)
//   - view / join:          any signed-in user
//   - schedule / add-member / remind:  admin only
// ═══════════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { notifyDarsGroup } from '../lib/fcm';
import { darsRemindLimiter } from '../middleware/rateLimit';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

// ─── Validation ─────────────────────────────────────────────────────
const createGroupSchema = z.object({
  name: z.string().trim().min(2, 'Name too short').max(120),
  description: z.string().trim().max(2000).optional(),
});

const addMemberSchema = z.object({
  email: z.string().trim().email('Enter a valid email').max(255),
});

const scheduleSchema = z.object({
  title: z.string().trim().max(160).optional(),
  // ISO 8601 datetime; must be in the future (checked below).
  scheduledAt: z.string().datetime({ offset: true }),
  // Whether to also push a "new dars scheduled" heads-up to members now.
  notify: z.boolean().optional(),
});

const remindSchema = z.object({
  message: z.string().trim().max(300).optional(),
  // Optionally tie the reminder to a specific upcoming session.
  sessionId: z.string().uuid().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────

// URL-safe, short, lowercase code. 8 chars of base32-ish alphabet from 5
// random bytes → ~40 bits, collision-resistant enough for share links; we
// also retry-on-collision at insert time.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no i/l/o/0/1 (ambiguous)
function genShareCode(len = 8): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

// Serialize a group + its membership for a specific viewer. `role` reflects
// the viewer's standing ('admin' | 'member' | null). Members list is only
// exposed to people who are in the group.
type GroupWithRelations = {
  id: string;
  name: string;
  description: string | null;
  shareCode: string;
  adminId: string;
  createdAt: Date;
  members: Array<{ userId: string; role: string; joinedAt: Date; user: { id: string; fullName: string | null; email: string } }>;
  sessions: Array<{ id: string; title: string | null; scheduledAt: Date }>;
};

function viewerRole(group: GroupWithRelations, userId: string): 'admin' | 'member' | null {
  const m = group.members.find(x => x.userId === userId);
  if (!m) return null;
  return m.role === 'admin' ? 'admin' : 'member';
}

function serializeGroup(group: GroupWithRelations, userId: string) {
  const role = viewerRole(group, userId);
  const isMember = role !== null;
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    // Only members (who can invite) get the share code back.
    shareCode: isMember ? group.shareCode : undefined,
    adminId: group.adminId,
    role,
    memberCount: group.members.length,
    createdAt: group.createdAt,
    members: isMember
      ? group.members.map(m => ({
          userId: m.userId,
          role: m.role,
          name: m.user.fullName || m.user.email.split('@')[0],
          email: m.user.email,
          joinedAt: m.joinedAt,
        }))
      : undefined,
    // Only upcoming sessions, soonest first.
    sessions: isMember
      ? group.sessions
          .filter(s => s.scheduledAt.getTime() > Date.now())
          .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
          .map(s => ({ id: s.id, title: s.title, scheduledAt: s.scheduledAt }))
      : undefined,
  };
}

const groupInclude = {
  members: { include: { user: { select: { id: true, fullName: true, email: true } } } },
  sessions: true,
} as const;

async function loadGroupOr404(id: string): Promise<GroupWithRelations> {
  const group = await prisma.darsGroup.findFirst({
    where: { id, deletedAt: null },
    include: groupInclude,
  });
  if (!group) throw new AppError(404, 'Dars group not found');
  return group as unknown as GroupWithRelations;
}

function requireAdmin(group: GroupWithRelations, userId: string) {
  if (viewerRole(group, userId) !== 'admin') {
    throw new AppError(403, 'Only the group admin can do that');
  }
}

router.use(authenticate);

// ─── Create a group ─────────────────────────────────────────────────
// Creator becomes the admin AND a member (so member lists / topic subs are
// uniform). The share code is generated with retry-on-collision.
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, `Validation Error: ${parsed.error.issues.map(i => i.message).join('; ')}`);
    const { name, description } = parsed.data;

    let group;
    for (let attempt = 0; attempt < 5; attempt++) {
      const shareCode = genShareCode();
      try {
        group = await prisma.darsGroup.create({
          data: {
            name,
            description: description ?? null,
            shareCode,
            adminId: req.user!.id,
            members: { create: { userId: req.user!.id, role: 'admin' } },
          },
          include: groupInclude,
        });
        break;
      } catch (err: any) {
        // Unique-constraint clash on share_code → regenerate and retry.
        if (err?.code === 'P2002') continue;
        throw err;
      }
    }
    if (!group) throw new AppError(500, 'Could not generate a unique share code, try again');

    res.status(201).json({ group: serializeGroup(group as unknown as GroupWithRelations, req.user!.id) });
  })
);

// ─── List my groups ─────────────────────────────────────────────────
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const memberships = await prisma.darsGroupMember.findMany({
      where: { userId: req.user!.id, group: { deletedAt: null } },
      include: { group: { include: groupInclude } },
      orderBy: { joinedAt: 'desc' },
    });
    const groups = memberships.map(m =>
      serializeGroup(m.group as unknown as GroupWithRelations, req.user!.id));
    res.json({ groups });
  })
);

// ─── Preview a group by share code (before joining) ─────────────────
// Lets the join deep-link show "You've been invited to <name>" without
// forcing the user to commit first. Returns a thin view (no member list).
router.get(
  '/join/:code',
  asyncHandler(async (req: Request, res: Response) => {
    const code = String(req.params.code || '').trim().toLowerCase();
    const group = await prisma.darsGroup.findFirst({
      where: { shareCode: code, deletedAt: null },
      include: groupInclude,
    });
    if (!group) throw new AppError(404, 'That invite link is invalid or expired');
    const g = group as unknown as GroupWithRelations;
    res.json({
      group: {
        id: g.id,
        name: g.name,
        description: g.description,
        memberCount: g.members.length,
        alreadyMember: viewerRole(g, req.user!.id) !== null,
      },
    });
  })
);

// ─── Join a group via share code ────────────────────────────────────
router.post(
  '/join/:code',
  asyncHandler(async (req: Request, res: Response) => {
    const code = String(req.params.code || '').trim().toLowerCase();
    const existing = await prisma.darsGroup.findFirst({
      where: { shareCode: code, deletedAt: null },
      include: groupInclude,
    });
    if (!existing) throw new AppError(404, 'That invite link is invalid or expired');
    const g = existing as unknown as GroupWithRelations;

    if (viewerRole(g, req.user!.id) === null) {
      await prisma.darsGroupMember.create({
        data: { groupId: g.id, userId: req.user!.id, role: 'member' },
      });
    }
    const fresh = await loadGroupOr404(g.id);
    res.json({ group: serializeGroup(fresh, req.user!.id) });
  })
);

// ─── Get one group (members only) ───────────────────────────────────
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const group = await loadGroupOr404(req.params.id);
    if (viewerRole(group, req.user!.id) === null) {
      throw new AppError(403, 'Join this group to view it');
    }
    res.json({ group: serializeGroup(group, req.user!.id) });
  })
);

// ─── Admin adds a member by email ───────────────────────────────────
// The invitee must already have an account (they've signed into the app).
// Adding them also lands them in the group's topic once their device syncs
// membership — but the reliable subscribe happens when THEY open the app,
// so we don't try to push a topic-subscribe from the server.
router.post(
  '/:id/members',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, `Validation Error: ${parsed.error.issues.map(i => i.message).join('; ')}`);
    const group = await loadGroupOr404(req.params.id);
    requireAdmin(group, req.user!.id);

    const email = parsed.data.email.toLowerCase();
    const invitee = await prisma.user.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
    if (!invitee) throw new AppError(404, 'No Takbeer Time account found for that email. Ask them to sign up first, or share the invite link.');

    if (viewerRole(group, invitee.id) !== null) {
      throw new AppError(400, 'That person is already in the group');
    }
    await prisma.darsGroupMember.create({
      data: { groupId: group.id, userId: invitee.id, role: 'member' },
    });
    const fresh = await loadGroupOr404(group.id);
    res.status(201).json({ group: serializeGroup(fresh, req.user!.id) });
  })
);

// ─── Admin removes a member ─────────────────────────────────────────
router.delete(
  '/:id/members/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const group = await loadGroupOr404(req.params.id);
    requireAdmin(group, req.user!.id);
    if (req.params.userId === group.adminId) {
      throw new AppError(400, 'The admin cannot be removed');
    }
    await prisma.darsGroupMember.deleteMany({
      where: { groupId: group.id, userId: req.params.userId },
    });
    const fresh = await loadGroupOr404(group.id);
    res.json({ group: serializeGroup(fresh, req.user!.id) });
  })
);

// ─── Admin schedules a session ──────────────────────────────────────
router.post(
  '/:id/sessions',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, `Validation Error: ${parsed.error.issues.map(i => i.message).join('; ')}`);
    const group = await loadGroupOr404(req.params.id);
    requireAdmin(group, req.user!.id);

    const scheduledAt = new Date(parsed.data.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) throw new AppError(400, 'Invalid date/time');
    if (scheduledAt.getTime() <= Date.now()) throw new AppError(400, 'Pick a time in the future');

    const session = await prisma.darsSession.create({
      data: {
        groupId: group.id,
        title: parsed.data.title ?? null,
        scheduledAt,
        createdById: req.user!.id,
      },
    });

    const fresh = await loadGroupOr404(group.id);
    res.status(201).json({ group: serializeGroup(fresh, req.user!.id), session });

    // Optional fire-and-forget heads-up push to the whole group.
    if (parsed.data.notify) {
      notifyDarsGroup({
        groupId: group.id,
        groupName: group.name,
        kind: 'scheduled',
        message: parsed.data.title,
        sessionAt: scheduledAt.toISOString(),
      }).then(r => {
        // eslint-disable-next-line no-console
        console.info('[dars] scheduled fcm result', { groupId: group.id, ...r });
      }).catch(err => {
        // eslint-disable-next-line no-console
        console.error('[dars] notifyDarsGroup(scheduled) failed', { err: (err as Error).message });
      });
    }
  })
);

// ─── Admin fires the "remind everyone" push (the top-of-screen button) ─
router.post(
  '/:id/remind',
  darsRemindLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = remindSchema.safeParse(req.body || {});
    if (!parsed.success) throw new AppError(400, `Validation Error: ${parsed.error.issues.map(i => i.message).join('; ')}`);
    const group = await loadGroupOr404(req.params.id);
    requireAdmin(group, req.user!.id);

    let sessionAt: string | undefined;
    let sessionTitle: string | undefined;
    if (parsed.data.sessionId) {
      const s = group.sessions.find(x => x.id === parsed.data.sessionId);
      if (s) { sessionAt = s.scheduledAt.toISOString(); sessionTitle = s.title ?? undefined; }
    }

    const result = await notifyDarsGroup({
      groupId: group.id,
      groupName: group.name,
      kind: 'reminder',
      message: parsed.data.message || sessionTitle,
      sessionAt,
    });
    // eslint-disable-next-line no-console
    console.info('[dars] remind fcm result', { groupId: group.id, ...result });

    // Report the outcome so the admin's UI can say "sent" vs "push is off".
    res.json({ ok: true, delivery: result });
  })
);

export default router;
