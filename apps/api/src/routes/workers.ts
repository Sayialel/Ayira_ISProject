import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { asyncHandler } from '../lib/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { requireUser, userClient, assertNoDbError } from '../lib/http';

export const workerRouter = Router();

const uuid = z.string().uuid();

/** Columns exposed on a public profile — deliberately excludes email and phone. */
const PUBLIC_PROFILE_FIELDS =
  'id, full_name, avatar_url, bio, skills, location, reputation_score, is_verified, role, created_at';

const updateProfileSchema = z
  .object({
    full_name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(10).max(20),
    bio: z.string().trim().max(500),
    skills: z.array(z.string().trim().min(1)).max(30),
    location: z.string().trim().min(1).max(120),
    avatar_url: z.string().url(),
  })
  .partial();

// GET /api/workers/profile — the caller's own profile
workerRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);

    const { data, error } = await userClient(req)
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    assertNoDbError(error, 'Failed to load profile');
    if (!data) throw new AppError('Profile not found', 404);

    res.json({ data });
  })
);

// PATCH /api/workers/profile — update the caller's own profile
workerRouter.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const patch = updateProfileSchema.parse(req.body);

    if (Object.keys(patch).length === 0) {
      throw new AppError('No fields to update', 400);
    }

    const { data, error } = await userClient(req)
      .from('users')
      .update(patch)
      .eq('id', userId)
      .select('*')
      .single();

    assertNoDbError(error, 'Failed to update profile');
    res.json({ data });
  })
);

// GET /api/workers/dashboard/stats — headline numbers for the caller's dashboard
// Declared before "/profile/:id" is irrelevant (different prefix), but kept
// above it for readability.
workerRouter.get(
  '/dashboard/stats',
  asyncHandler(async (req, res) => {
    const { userId, role } = requireUser(req);
    const db = supabaseAdmin;

    if (role === 'employer') {
      // The spec scopes this endpoint to workers, but the employer dashboard
      // needs the same shape of summary, so it is served here by role.
      const [posted, open, inProgress, completed, applicants, escrow] = await Promise.all([
        db.from('gigs').select('id', { count: 'exact', head: true }).eq('employer_id', userId),
        db
          .from('gigs')
          .select('id', { count: 'exact', head: true })
          .eq('employer_id', userId)
          .eq('status', 'open'),
        db
          .from('gigs')
          .select('id', { count: 'exact', head: true })
          .eq('employer_id', userId)
          .eq('status', 'in_progress'),
        db
          .from('gigs')
          .select('id', { count: 'exact', head: true })
          .eq('employer_id', userId)
          .eq('status', 'completed'),
        db.from('applications').select('id, gigs!inner(employer_id)', {
          count: 'exact',
          head: true,
        }).eq('gigs.employer_id', userId),
        db.from('escrow').select('amount, status').eq('employer_id', userId),
      ]);

      const escrowRows = escrow.data ?? [];
      const sumWhere = (statuses: string[]) =>
        escrowRows
          .filter((row) => statuses.includes(row.status))
          .reduce((total, row) => total + Number(row.amount ?? 0), 0);

      return res.json({
        data: {
          role: 'employer',
          total_gigs: posted.count ?? 0,
          open_gigs: open.count ?? 0,
          active_gigs: inProgress.count ?? 0,
          completed_gigs: completed.count ?? 0,
          total_applicants: applicants.count ?? 0,
          escrow_held: sumWhere(['funded', 'disputed']),
          total_paid_out: sumWhere(['released']),
        },
      });
    }

    const [applications, accepted, reviews, escrow] = await Promise.all([
      db.from('applications').select('id', { count: 'exact', head: true }).eq('worker_id', userId),
      // One round trip for both active and completed counts, via the gig status.
      db
        .from('applications')
        .select('id, gigs!inner(status)')
        .eq('worker_id', userId)
        .eq('status', 'accepted'),
      db.from('reviews').select('rating').eq('reviewee_id', userId),
      db.from('escrow').select('amount').eq('worker_id', userId).eq('status', 'released'),
    ]);

    assertNoDbError(accepted.error, 'Failed to load dashboard stats');

    type AcceptedRow = { gigs: { status: string } | { status: string }[] | null };
    const gigStatusOf = (row: AcceptedRow): string | null => {
      // PostgREST returns an embedded row as an object, but typings allow an array.
      const gig = Array.isArray(row.gigs) ? row.gigs[0] : row.gigs;
      return gig?.status ?? null;
    };

    const acceptedRows = (accepted.data ?? []) as unknown as AcceptedRow[];
    const ratings = (reviews.data ?? []).map((r) => Number(r.rating));
    const earnings = (escrow.data ?? []).reduce(
      (total, row) => total + Number(row.amount ?? 0),
      0
    );

    res.json({
      data: {
        role: 'worker',
        total_applications: applications.count ?? 0,
        active_gigs: acceptedRows.filter((r) => gigStatusOf(r) === 'in_progress').length,
        completed_gigs: acceptedRows.filter((r) => gigStatusOf(r) === 'completed').length,
        average_rating: ratings.length
          ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
          : 0,
        total_reviews: ratings.length,
        total_earnings: earnings,
      },
    });
  })
);

// GET /api/workers/profile/:id — another user's public profile
workerRouter.get(
  '/profile/:id',
  asyncHandler(async (req, res) => {
    requireUser(req);
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('Profile not found', 404);

    const { data, error } = await userClient(req)
      .from('users')
      .select(PUBLIC_PROFILE_FIELDS)
      .eq('id', parsed.data)
      .maybeSingle();

    assertNoDbError(error, 'Failed to load profile');
    if (!data) throw new AppError('Profile not found', 404);

    // Public-facing track record, useful on both worker and employer profiles.
    const [completedGigs, reviews] = await Promise.all([
      supabaseAdmin
        .from('applications')
        .select('id, gigs!inner(status)')
        .eq('worker_id', parsed.data)
        .eq('status', 'accepted'),
      supabaseAdmin.from('reviews').select('rating').eq('reviewee_id', parsed.data),
    ]);

    type CompletedRow = { gigs: { status: string } | { status: string }[] | null };
    const rows = (completedGigs.data ?? []) as unknown as CompletedRow[];
    const completed = rows.filter((row) => {
      const gig = Array.isArray(row.gigs) ? row.gigs[0] : row.gigs;
      return gig?.status === 'completed';
    }).length;

    res.json({
      data: {
        ...data,
        completed_gigs: completed,
        total_reviews: (reviews.data ?? []).length,
      },
    });
  })
);
