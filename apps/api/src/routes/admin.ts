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
        db.from('escrow').select('amount, released_amount, status'),
      ]);

    assertNoDbError(escrow.error, 'Failed to load escrow totals');

    const escrowRows = escrow.data ?? [];

    /** Money the platform is still holding, by status. */
    const sumWhere = (statuses: string[]) =>
      escrowRows
        .filter((row) => statuses.includes(row.status))
        .reduce((total, row) => total + Number(row.amount ?? 0), 0);

    // Everything that has actually reached a worker, which is released_amount
    // on both a full release and a split. Summing `amount` over status
    // 'released' alone -- as this did while partial_release was unreachable --
    // would now miss every split and overstate the ones it did count.
    const totalReleased = escrowRows.reduce(
      (total, row) => total + Number(row.released_amount ?? 0),
      0
    );

    res.json({
      data: {
        total_users: users.count ?? 0,
        total_workers: workers.count ?? 0,
        total_employers: employers.count ?? 0,
        total_gigs: gigs.count ?? 0,
        open_gigs: openGigs.count ?? 0,
        in_progress_gigs: inProgress.count ?? 0,
        total_applications: applications.count ?? 0,
        // A split escrow is settled, not active -- the money has left. It was
        // counted here while partial_release could never be reached, which was
        // harmless then and would overstate funds held now.
        active_escrow_amount: sumWhere(['funded', 'disputed']),
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

/* -------------------------------------------------------------------------- */
/* Escrow oversight and dispute resolution                                    */
/* -------------------------------------------------------------------------- */

/**
 * A disputed escrow can only be moved by an administrator — transition_escrow
 * permits disputed → released or disputed → refunded for nobody else. Until
 * these routes existed no interface could do it, so raising a dispute froze
 * the money permanently and the only remedy was raw SQL. The escrow page even
 * promises the user that "an administrator will review it".
 */

const ESCROW_ADMIN_FIELDS =
  'id, gig_id, employer_id, worker_id, amount, currency, mpesa_checkout_id, ' +
  'mpesa_receipt, status, funded_at, released_at, released_amount, ' +
  'created_at, updated_at';

const ESCROW_ADMIN_WITH_PARTIES =
  ESCROW_ADMIN_FIELDS +
  ', gig:gigs!gig_id(id, title, status, category)' +
  ', employer:users!escrow_employer_id_fkey(id, full_name, email, avatar_url)' +
  ', worker:users!escrow_worker_id_fkey(id, full_name, email, avatar_url)';

const escrowListQuerySchema = paginationSchema.extend({
  status: z
    .enum([
      'pending',
      'funded',
      'released',
      'disputed',
      'refunded',
      'partial_release',
      'cancelled',
    ])
    .optional(),
});

const resolveSchema = z
  .object({
    // Release pays the worker in full, refund returns everything to the
    // employer, and partial_release splits it -- which is what a dispute over
    // half-finished work actually needs.
    outcome: z.enum(['released', 'refunded', 'partial_release']),
    // Required, and written onto the escrow event. A decision that moves
    // someone's money should not be recordable without a reason attached.
    reason: z
      .string()
      .trim()
      .min(10, 'Give a reason of at least 10 characters')
      .max(1000),
    // What the worker is paid, for a split only. Whole shillings, matching the
    // funding side: a split is a figure that has to be payable over M-Pesa,
    // and M-Pesa cannot move cents. A 1000 escrow split in thirds therefore
    // settles at 333/667 rather than recording a 333.33 nobody can transfer.
    worker_amount: z
      .number()
      .int('Enter a whole number of shillings — M-Pesa cannot pay cents')
      .positive('The worker must be paid more than zero')
      .optional(),
  })
  .refine((v) => v.outcome !== 'partial_release' || v.worker_amount !== undefined, {
    message: 'A split needs the amount to pay the worker',
    path: ['worker_amount'],
  })
  // Rejected rather than ignored. Sending an amount with a full release or a
  // refund means the caller believes it will be honoured, and silently
  // dropping it is how someone ends up thinking they split an escrow they
  // actually released in full.
  .refine((v) => v.outcome === 'partial_release' || v.worker_amount === undefined, {
    message: 'An amount only applies to a split',
    path: ['worker_amount'],
  });

// GET /api/admin/escrow — every transaction on the platform
adminRouter.get(
  '/escrow',
  asyncHandler(async (req, res) => {
    const q = escrowListQuerySchema.parse(req.query);
    const { from, to } = toRange(q.page, q.limit);

    let query = supabaseAdmin
      .from('escrow')
      .select(ESCROW_ADMIN_WITH_PARTIES, { count: 'exact' });

    if (q.status) query = query.eq('status', q.status);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    assertNoDbError(error, 'Failed to load escrow transactions');

    // Counted separately so the UI can lead with what needs a decision rather
    // than making someone page through settled transactions to find it.
    const { count: disputed } = await supabaseAdmin
      .from('escrow')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'disputed');

    res.json({
      data: {
        escrow: data ?? [],
        disputed_count: disputed ?? 0,
        ...buildPageMeta(count ?? 0, q.page, q.limit),
      },
    });
  })
);

// GET /api/admin/escrow/:id — one transaction with its full history
adminRouter.get(
  '/escrow/:id',
  asyncHandler(async (req, res) => {
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('Escrow not found', 404);

    const { data, error } = await supabaseAdmin
      .from('escrow')
      .select(ESCROW_ADMIN_WITH_PARTIES)
      .eq('id', parsed.data)
      .maybeSingle();

    assertNoDbError(error, 'Failed to load the transaction');
    if (!data) throw new AppError('Escrow not found', 404);

    // The audit trail is the substance of reviewing a dispute: who moved the
    // money, when, and what they said about it.
    const { data: events, error: eventsError } = await supabaseAdmin
      .from('escrow_events')
      .select(
        'id, from_status, to_status, actor_id, detail, created_at, ' +
          'actor:users!actor_id(id, full_name, role)'
      )
      .eq('escrow_id', parsed.data)
      .order('created_at', { ascending: true });

    assertNoDbError(eventsError, 'Failed to load the transaction history');

    res.json({ data: { escrow: data, events: events ?? [] } });
  })
);

// POST /api/admin/escrow/:id/resolve — settle a dispute
adminRouter.post(
  '/escrow/:id/resolve',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('Escrow not found', 404);

    const body = resolveSchema.parse(req.body);

    // The rules stay in transition_escrow, which refuses anything that is not
    // a disputed escrow moved by an admin. This only translates the refusal,
    // so the two cannot drift apart.
    const { error } = await supabaseAdmin.rpc('transition_escrow', {
      p_escrow_id: parsed.data,
      p_actor_id: userId,
      p_to_status: body.outcome,
      p_detail: `Dispute resolved by an administrator: ${body.reason}`,
      // null rather than undefined: supabase-js omits undefined keys, and the
      // function would then take its own default, which is the same NULL --
      // but being explicit means a renamed parameter fails loudly here instead
      // of quietly passing no amount at all.
      p_amount: body.worker_amount ?? null,
    });

    if (error) {
      const text = error.message ?? '';
      if (/not found/i.test(text)) throw new AppError(text, 404);
      if (/only an administrator|not a party/i.test(text)) {
        throw new AppError(text, 403);
      }
      throw new AppError(text || 'Could not resolve the dispute', 409);
    }

    const { data, error: readError } = await supabaseAdmin
      .from('escrow')
      .select(ESCROW_ADMIN_WITH_PARTIES)
      .eq('id', parsed.data)
      .single();

    assertNoDbError(readError, 'Dispute resolved but the record could not be re-read');
    res.json({ data });
  })
);

// POST /api/admin/gigs/:id/cancel — moderation
//
// DELETE /api/gigs/:id is restricted to the owning employer, so an admin could
// not take a gig down at all. Cancelling rather than deleting keeps the row and
// its applications for the audit trail.
adminRouter.post(
  '/gigs/:id/cancel',
  asyncHandler(async (req, res) => {
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('Gig not found', 404);

    const { reason } = z
      .object({ reason: z.string().trim().min(5).max(500) })
      .parse(req.body ?? {});

    const { data: existing, error: readError } = await supabaseAdmin
      .from('gigs')
      .select('id, status')
      .eq('id', parsed.data)
      .maybeSingle();

    assertNoDbError(readError, 'Failed to load the gig');
    if (!existing) throw new AppError('Gig not found', 404);

    if (existing.status === 'completed' || existing.status === 'cancelled') {
      throw new AppError(`This gig is already ${existing.status}.`, 409);
    }

    // Refused rather than silently stranding money: cancelling a gig whose
    // escrow still holds funds would leave that escrow pointing at dead work.
    //
    // partial_release is not in this list. A split has already paid both sides
    // and holds nothing, so it strands no money -- and listing it here would
    // make a gig that was split while not in_progress permanently
    // un-cancellable, with no way for an administrator to tidy it up.
    const { data: live, error: escrowError } = await supabaseAdmin
      .from('escrow')
      .select('id, status')
      .eq('gig_id', parsed.data)
      .in('status', ['pending', 'funded', 'disputed']);

    assertNoDbError(escrowError, 'Failed to check escrow on this gig');
    if ((live ?? []).length > 0) {
      throw new AppError(
        'This gig has escrow that is still open. Settle the payment before cancelling it.',
        409
      );
    }

    const { data, error } = await supabaseAdmin
      .from('gigs')
      .update({ status: 'cancelled' })
      .eq('id', parsed.data)
      .select('id, title, status')
      .single();

    assertNoDbError(error, 'Failed to cancel the gig');
    console.warn(`Admin cancelled gig ${parsed.data}: ${reason}`);
    res.json({ data });
  })
);
