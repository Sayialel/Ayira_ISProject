import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { asyncHandler } from '../lib/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import {
  requireUser,
  userClient,
  assertNoDbError,
  paginationSchema,
  toRange,
  buildPageMeta,
} from '../lib/http';

export const reviewRouter = Router();

/**
 * Reviews are what give both sides a reputation, and until now there was no way
 * to write one. The table, the RLS policy and the trigger have existed since
 * migrations 005, 012 and 010 — but no endpoint, so no review had ever been
 * created and every reputation on the platform sat at 0.00.
 *
 * Who may review whom is decided by the database, not here. The policy added
 * in migration 012 requires the gig to be completed, requires an accepted
 * application linking the two people, forbids reviewing yourself, and allows
 * only employer→worker or worker→employer. Writing through the caller's own
 * client rather than the service role is what puts that policy in the path:
 * using supabaseAdmin here would bypass every one of those checks.
 */

const uuid = z.string().uuid();

const REVIEWER_FIELDS = 'id, full_name, avatar_url, role';

const REVIEW_COLUMNS =
  'id, gig_id, reviewer_id, reviewee_id, rating, comment, created_at';

const REVIEW_WITH_PEOPLE =
  `${REVIEW_COLUMNS}, reviewer:users!reviewer_id(${REVIEWER_FIELDS}), ` +
  'gig:gigs!gig_id(id, title, category)';

const createSchema = z.object({
  gig_id: uuid,
  reviewee_id: uuid,
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

const listQuerySchema = paginationSchema.extend({
  user_id: uuid.optional(),
  gig_id: uuid.optional(),
});

// GET /api/reviews — reviews about a person, or on a gig
reviewRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const q = listQuerySchema.parse(req.query);
    const { from, to } = toRange(q.page, q.limit);

    // Defaults to the caller, so "my reviews" needs no argument.
    const subject = q.user_id ?? userId;

    let query = supabaseAdmin
      .from('reviews')
      .select(REVIEW_WITH_PEOPLE, { count: 'exact' })
      .eq('reviewee_id', subject);

    if (q.gig_id) query = query.eq('gig_id', q.gig_id);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    assertNoDbError(error, 'Failed to load reviews');

    // The joined select widens each row to a union that includes an error
    // shape, so the cast goes through unknown rather than pretending the
    // shapes overlap.
    const ratings = (data ?? []).map((row) =>
      Number((row as unknown as { rating: number }).rating)
    );

    res.json({
      data: {
        reviews: data ?? [],
        // Averaged over this page only; users.reputation_score is the
        // authoritative figure across every review.
        average_on_page: ratings.length
          ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
          : null,
        ...buildPageMeta(count ?? 0, q.page, q.limit),
      },
    });
  })
);

// GET /api/reviews/pending — completed gigs the caller still owes a review on
//
// Without this the feature is invisible: nobody opens a gig they finished last
// week to check whether they left a review.
reviewRouter.get(
  '/pending',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);

    // Completed gigs where the caller was either the employer or the hired
    // worker. Both sides may review, so both are collected.
    const { data: asEmployer, error: employerError } = await supabaseAdmin
      .from('gigs')
      .select('id, title, status, employer_id, applications!inner(worker_id, status)')
      .eq('employer_id', userId)
      .eq('status', 'completed')
      .eq('applications.status', 'accepted');

    assertNoDbError(employerError, 'Failed to load completed gigs');

    const { data: asWorker, error: workerError } = await supabaseAdmin
      .from('applications')
      .select('worker_id, status, gig:gigs!inner(id, title, status, employer_id)')
      .eq('worker_id', userId)
      .eq('status', 'accepted')
      .eq('gigs.status', 'completed');

    assertNoDbError(workerError, 'Failed to load completed work');

    type Candidate = { gig_id: string; title: string; reviewee_id: string; role: string };
    const candidates: Candidate[] = [];

    for (const gig of asEmployer ?? []) {
      const row = gig as unknown as {
        id: string;
        title: string;
        applications: { worker_id: string }[];
      };
      for (const application of row.applications ?? []) {
        candidates.push({
          gig_id: row.id,
          title: row.title,
          reviewee_id: application.worker_id,
          role: 'worker',
        });
      }
    }

    for (const application of asWorker ?? []) {
      const row = application as unknown as {
        gig: { id: string; title: string; employer_id: string };
      };
      if (!row.gig) continue;
      candidates.push({
        gig_id: row.gig.id,
        title: row.gig.title,
        reviewee_id: row.gig.employer_id,
        role: 'employer',
      });
    }

    if (candidates.length === 0) {
      return res.json({ data: { pending: [] } });
    }

    // Drop the ones already reviewed. UNIQUE(gig_id, reviewer_id) means one
    // review per gig per person, so the caller's own rows are enough to know.
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('reviews')
      .select('gig_id')
      .eq('reviewer_id', userId)
      .in('gig_id', candidates.map((c) => c.gig_id));

    assertNoDbError(existingError, 'Failed to check existing reviews');

    const reviewed = new Set((existing ?? []).map((r) => (r as { gig_id: string }).gig_id));

    res.json({
      data: { pending: candidates.filter((c) => !reviewed.has(c.gig_id)) },
    });
  })
);

// POST /api/reviews — leave a review for the other party on a completed gig
reviewRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const body = createSchema.parse(req.body);

    if (body.reviewee_id === userId) {
      throw new AppError('You cannot review yourself.', 400);
    }

    // Through the caller's client, so the migration-012 policy decides whether
    // this is allowed. supabaseAdmin would skip it entirely.
    const { data, error } = await userClient(req)
      .from('reviews')
      .insert({
        gig_id: body.gig_id,
        reviewer_id: userId,
        reviewee_id: body.reviewee_id,
        rating: body.rating,
        comment: body.comment ?? null,
      })
      .select(REVIEW_WITH_PEOPLE)
      .single();

    if (error) {
      // 23505 is the UNIQUE(gig_id, reviewer_id) constraint.
      if (error.code === '23505') {
        throw new AppError('You have already reviewed this gig.', 409);
      }
      // A policy refusal arrives as a permission error rather than a
      // description of the rule, so the reason is spelled out here.
      if (error.code === '42501' || /row-level security/i.test(error.message)) {
        throw new AppError(
          'You can only review the other party on a gig you completed together.',
          403
        );
      }
      throw new AppError(error.message || 'Could not save the review', 400);
    }

    res.status(201).json({ data });
  })
);
