import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { asyncHandler } from '../lib/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { requireRole, invalidateRoleCache } from '../middleware/auth';
import {
  requireUser,
  assertNoDbError,
  paginationSchema,
  toRange,
  buildPageMeta,
  sanitizeSearchTerm,
} from '../lib/http';

export const adminRouter = Router();

// Every route below is staff-only. Admin reads deliberately use supabaseAdmin,
// since the whole point is a platform-wide view that RLS would otherwise scope
// down to the caller's own rows.
adminRouter.use(requireRole('admin'));

const uuid = z.string().uuid();

const userListQuerySchema = paginationSchema.extend({
  search: z.string().trim().min(1).optional(),
  role: z.enum(['worker', 'employer', 'admin']).optional(),
  is_verified: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const gigListQuerySchema = paginationSchema.extend({
  status: z.enum(['draft', 'open', 'in_progress', 'completed', 'cancelled']).optional(),
  search: z.string().trim().min(1).optional(),
});

// GET /api/admin/dashboard — platform-wide totals
adminRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    requireUser(req);
    const db = supabaseAdmin;
    const headCount = { count: 'exact', head: true } as const;

    const [users, workers, employers, gigs, openGigs, inProgress, applications, escrow] =
      await Promise.all([
        db.from('users').select('id', headCount),
        db.from('users').select('id', headCount).eq('role', 'worker'),
        db.from('users').select('id', headCount).eq('role', 'employer'),
        db.from('gigs').select('id', headCount),
        db.from('gigs').select('id', headCount).eq('status', 'open'),
        db.from('gigs').select('id', headCount).eq('status', 'in_progress'),
        db.from('applications').select('id', headCount),
        db.from('escrow').select('amount, status'),
      ]);

    assertNoDbError(escrow.error, 'Failed to load escrow totals');

    const escrowRows = escrow.data ?? [];
    const sumWhere = (statuses: string[]) =>
      escrowRows
        .filter((row) => statuses.includes(row.status))
        .reduce((total, row) => total + Number(row.amount ?? 0), 0);

    const totalReleased = sumWhere(['released']);

    res.json({
      data: {
        total_users: users.count ?? 0,
        total_workers: workers.count ?? 0,
        total_employers: employers.count ?? 0,
        total_gigs: gigs.count ?? 0,
        open_gigs: openGigs.count ?? 0,
        in_progress_gigs: inProgress.count ?? 0,
        total_applications: applications.count ?? 0,
        active_escrow_amount: sumWhere(['funded', 'disputed', 'partial_release']),
        total_released_amount: totalReleased,
        // No commission is charged yet, so platform revenue is reported as zero
        // rather than implied from transaction volume.
        total_platform_revenue: 0,
      },
    });
  })
);

// GET /api/admin/users — paginated directory with search
adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const q = userListQuerySchema.parse(req.query);
    const { from, to } = toRange(q.page, q.limit);

    let query = supabaseAdmin
      .from('users')
      .select(
        'id, email, full_name, phone, role, avatar_url, location, skills, reputation_score, is_verified, created_at',
        { count: 'exact' }
      );

    if (q.role) query = query.eq('role', q.role);
    if (q.is_verified !== undefined) query = query.eq('is_verified', q.is_verified);
    if (q.search) {
      const term = sanitizeSearchTerm(q.search);
      if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    assertNoDbError(error, 'Failed to load users');

    res.json({
      data: { users: data ?? [], ...buildPageMeta(count ?? 0, q.page, q.limit) },
    });
  })
);

// PATCH /api/admin/users/:id/verify — flip a user's verified badge
adminRouter.patch(
  '/users/:id/verify',
  asyncHandler(async (req, res) => {
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('User not found', 404);

    // Accepts { is_verified: false } so the action can also be undone.
    const { is_verified } = z
      .object({ is_verified: z.boolean().default(true) })
      .parse(req.body ?? {});

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ is_verified })
      .eq('id', parsed.data)
      .select('id, full_name, email, role, is_verified')
      .maybeSingle();

    assertNoDbError(error, 'Failed to update verification status');
    if (!data) throw new AppError('User not found', 404);

    // Drop any cached role for this user so an admin action takes effect on
    // their next request rather than after the cache TTL.
    invalidateRoleCache(parsed.data);

    res.json({ data });
  })
);

// GET /api/admin/gigs — every gig, including drafts and cancelled ones
adminRouter.get(
  '/gigs',
  asyncHandler(async (req, res) => {
    const q = gigListQuerySchema.parse(req.query);
    const { from, to } = toRange(q.page, q.limit);

    let query = supabaseAdmin
      .from('gigs')
      .select('*, employer:users!employer_id(id, full_name, email, avatar_url)', {
        count: 'exact',
      });

    if (q.status) query = query.eq('status', q.status);
    if (q.search) {
      const term = sanitizeSearchTerm(q.search);
      if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    assertNoDbError(error, 'Failed to load gigs');

    res.json({
      data: { gigs: data ?? [], ...buildPageMeta(count ?? 0, q.page, q.limit) },
    });
  })
);
