import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { asyncHandler } from '../lib/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { requireRole } from '../middleware/auth';
import {
  requireUser,
  userClient,
  assertNoDbError,
  paginationSchema,
  toRange,
  buildPageMeta,
  PG_UNIQUE_VIOLATION,
} from '../lib/http';
import type { ApplicationRow, ApplicationStatus, GigRow } from '../types/database';

export const applicationRouter = Router();

const uuid = z.string().uuid();

const GIG_EMBED =
  'gig:gigs!inner(id, title, category, status, budget_min, budget_max, currency, deadline, location, is_remote, employer_id, employer:users!employer_id(id, full_name, avatar_url))';
const WORKER_EMBED =
  'worker:users!worker_id(id, full_name, avatar_url, skills, location, reputation_score, is_verified)';

const createApplicationSchema = z.object({
  gig_id: uuid,
  cover_letter: z.string().trim().min(20, 'Cover letter must be at least 20 characters'),
  proposed_amount: z.number().positive('Proposed amount must be greater than zero'),
});

const listQuerySchema = paginationSchema.extend({
  status: z
    .enum(['pending', 'shortlisted', 'accepted', 'rejected', 'withdrawn'])
    .optional(),
  gig_id: uuid.optional(),
});

const statusSchema = z.object({
  status: z.enum(['shortlisted', 'accepted', 'rejected', 'withdrawn']),
});

/**
 * Which status changes each side may make, keyed by the current status.
 * Terminal statuses (accepted, rejected, withdrawn) are absent, so they cannot
 * be changed again by either party.
 */
const EMPLOYER_TRANSITIONS: Record<string, ApplicationStatus[]> = {
  pending: ['shortlisted', 'accepted', 'rejected'],
  shortlisted: ['accepted', 'rejected'],
};

const WORKER_TRANSITIONS: Record<string, ApplicationStatus[]> = {
  pending: ['withdrawn'],
  shortlisted: ['withdrawn'],
};

// POST /api/applications — apply to a gig (workers only)
applicationRouter.post(
  '/',
  requireRole('worker'),
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const body = createApplicationSchema.parse(req.body);

    const { data: gig, error: gigError } = await supabaseAdmin
      .from('gigs')
      .select('id, employer_id, status')
      .eq('id', body.gig_id)
      .maybeSingle();

    assertNoDbError(gigError, 'Failed to load gig');
    if (!gig) throw new AppError('Gig not found', 404);
    if (gig.employer_id === userId) {
      throw new AppError('You cannot apply to your own gig', 400);
    }
    if (gig.status !== 'open') {
      throw new AppError('This gig is no longer accepting applications', 409);
    }

    const { data, error } = await userClient(req)
      .from('applications')
      .insert({
        gig_id: body.gig_id,
        worker_id: userId,
        cover_letter: body.cover_letter,
        proposed_amount: body.proposed_amount,
        status: 'pending',
      })
      .select(`*, ${GIG_EMBED}`)
      .single();

    // The UNIQUE(gig_id, worker_id) constraint is the real guard against double
    // applications; translate it into a message the UI can show.
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw new AppError('You have already applied to this gig', 409);
    }
    assertNoDbError(error, 'Failed to submit application');

    res.status(201).json({ data });
  })
);

// GET /api/applications — the caller's applications (worker) or applications to
// their gigs (employer)
applicationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId, role } = requireUser(req);
    const q = listQuerySchema.parse(req.query);
    const { from, to } = toRange(q.page, q.limit);
    const isEmployer = role === 'employer';

    let query = userClient(req)
      .from('applications')
      .select(`*, ${GIG_EMBED}, ${WORKER_EMBED}`, { count: 'exact' });

    if (isEmployer) {
      query = query.eq('gig.employer_id', userId);
    } else {
      query = query.eq('worker_id', userId);
    }

    if (q.status) query = query.eq('status', q.status);
    if (q.gig_id) query = query.eq('gig_id', q.gig_id);

    // Employers read this grouped by gig, so sort by gig first for them.
    if (isEmployer) query = query.order('gig_id', { ascending: true });

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    assertNoDbError(error, 'Failed to load applications');

    res.json({
      data: {
        applications: data ?? [],
        ...buildPageMeta(count ?? 0, q.page, q.limit),
      },
    });
  })
);

// GET /api/applications/:id — a single application with gig and worker details
applicationRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('Application not found', 404);

    const { data, error } = await supabaseAdmin
      .from('applications')
      .select(`*, ${GIG_EMBED}, ${WORKER_EMBED}`)
      .eq('id', parsed.data)
      .maybeSingle();

    assertNoDbError(error, 'Failed to load application');
    if (!data) throw new AppError('Application not found', 404);

    const row = data as unknown as ApplicationRow & { gig: Pick<GigRow, 'employer_id'> };
    if (row.worker_id !== userId && row.gig?.employer_id !== userId) {
      throw new AppError('Application not found', 404);
    }

    res.json({ data });
  })
);

// PATCH /api/applications/:id/status — shortlist, accept, reject or withdraw
applicationRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('Application not found', 404);
    const { status: nextStatus } = statusSchema.parse(req.body);

    const { data: application, error } = await supabaseAdmin
      .from('applications')
      .select('*, gig:gigs!inner(id, employer_id, status, title)')
      .eq('id', parsed.data)
      .maybeSingle();

    assertNoDbError(error, 'Failed to load application');
    if (!application) throw new AppError('Application not found', 404);

    const row = application as unknown as ApplicationRow & {
      gig: Pick<GigRow, 'id' | 'employer_id' | 'status' | 'title'>;
    };

    const isEmployer = row.gig.employer_id === userId;
    const isWorker = row.worker_id === userId;
    if (!isEmployer && !isWorker) throw new AppError('Application not found', 404);

    const allowed = isEmployer
      ? (EMPLOYER_TRANSITIONS[row.status] ?? [])
      : (WORKER_TRANSITIONS[row.status] ?? []);

    if (!allowed.includes(nextStatus)) {
      throw new AppError(
        `Cannot change an application from "${row.status}" to "${nextStatus}"`,
        409
      );
    }

    if (nextStatus === 'accepted' && row.gig.status !== 'open') {
      throw new AppError(
        `This gig is "${row.gig.status}" and can no longer hire an applicant`,
        409
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('applications')
      .update({ status: nextStatus })
      .eq('id', row.id)
      // Re-assert the status we validated against, so two concurrent decisions
      // cannot both succeed.
      .eq('status', row.status)
      .select(`*, ${GIG_EMBED}, ${WORKER_EMBED}`)
      .maybeSingle();

    assertNoDbError(updateError, 'Failed to update application');
    if (!updated) {
      throw new AppError('This application was updated by someone else — reload and retry', 409);
    }

    if (nextStatus === 'accepted') {
      // Hiring closes the gig to further applicants and turns down the rest.
      const { error: gigError } = await supabaseAdmin
        .from('gigs')
        .update({ status: 'in_progress' })
        .eq('id', row.gig.id);
      assertNoDbError(gigError, 'Failed to update gig status');

      const { error: rejectError } = await supabaseAdmin
        .from('applications')
        .update({ status: 'rejected' })
        .eq('gig_id', row.gig.id)
        .neq('id', row.id)
        .in('status', ['pending', 'shortlisted']);
      assertNoDbError(rejectError, 'Failed to close remaining applications');
    }

    res.json({ data: updated });
  })
);
