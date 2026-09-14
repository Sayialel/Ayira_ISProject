import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { asyncHandler } from '../lib/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { requireRole } from '../middleware/auth';
import { GIG_CATEGORIES, DEFAULT_CURRENCY } from '../lib/constants';
import {
  requireUser,
  userClient,
  assertNoDbError,
  paginationSchema,
  toRange,
  buildPageMeta,
  sanitizeSearchTerm,
} from '../lib/http';
import type { GigRow, GigStatus } from '../types/database';

export const gigRouter = Router();

/** Employer fields safe to expose alongside a gig. */
const EMPLOYER_FIELDS = 'id, full_name, avatar_url, reputation_score, is_verified, location';
const GIG_WITH_EMPLOYER = `*, employer:users!employer_id(${EMPLOYER_FIELDS})`;

const uuid = z.string().uuid();

// `.transform` rather than `z.coerce.boolean()`, which maps the string "false"
// to true because any non-empty string is truthy.
const booleanParam = z.enum(['true', 'false']).transform((v) => v === 'true');

const gigBodySchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters'),
  description: z.string().trim().min(20, 'Description must be at least 20 characters'),
  category: z.enum(GIG_CATEGORIES),
  required_skills: z.array(z.string().trim().min(1)).max(20).default([]),
  location: z.string().trim().min(1).max(120).optional(),
  is_remote: z.boolean().default(false),
  budget_min: z.number().positive('Minimum budget must be greater than zero'),
  budget_max: z.number().positive('Maximum budget must be greater than zero'),
  currency: z.string().trim().length(3).default(DEFAULT_CURRENCY),
  deadline: z.string().min(1, 'Deadline is required'),
});

const createGigSchema = gigBodySchema
  .refine((d) => d.budget_max >= d.budget_min, {
    message: 'budget_max must be greater than or equal to budget_min',
    path: ['budget_max'],
  })
  .refine((d) => !Number.isNaN(new Date(d.deadline).getTime()), {
    message: 'Deadline must be a valid date',
    path: ['deadline'],
  })
  .refine((d) => new Date(d.deadline).getTime() > Date.now(), {
    message: 'Deadline must be in the future',
    path: ['deadline'],
  });

const updateGigSchema = gigBodySchema.partial();

const listQuerySchema = paginationSchema.extend({
  category: z.string().trim().min(1).optional(),
  location: z.string().trim().min(1).optional(),
  is_remote: booleanParam.optional(),
  min_budget: z.coerce.number().nonnegative().optional(),
  max_budget: z.coerce.number().nonnegative().optional(),
  search: z.string().trim().min(1).optional(),
  status: z.enum(['draft', 'open', 'in_progress', 'completed', 'cancelled']).default('open'),
  // "me" is a convenience for the employer's own gigs (used by /app/my-gigs).
  employer_id: z.union([z.literal('me'), uuid]).optional(),
});

function parseGigId(raw: string): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw new AppError('Gig not found', 404);
  return parsed.data;
}

/**
 * Loads a gig and asserts the caller is the employer who owns it.
 * Uses the admin client so the check is explicit in code rather than implicit
 * in an RLS filter that would otherwise surface as a confusing "not found".
 */
async function loadOwnedGig(gigId: string, userId: string): Promise<GigRow> {
  const { data, error } = await supabaseAdmin
    .from('gigs')
    .select('*')
    .eq('id', gigId)
    .maybeSingle();

  assertNoDbError(error, 'Failed to load gig');
  if (!data) throw new AppError('Gig not found', 404);
  if (data.employer_id !== userId) {
    throw new AppError('You do not have permission to modify this gig', 403);
  }
  return data as GigRow;
}

function assertEditableStatus(status: GigStatus) {
  if (status !== 'draft' && status !== 'open') {
    throw new AppError(`A gig with status "${status}" can no longer be edited`, 409);
  }
}

// GET /api/gigs/meta/categories — skill categories seeded by migration 009.
// Declared before "/:id" so the literal path is not captured as an id.
gigRouter.get(
  '/meta/categories',
  asyncHandler(async (req, res) => {
    const { data, error } = await userClient(req)
      .from('skill_categories')
      .select('id, name, skills')
      .order('name');

    assertNoDbError(error, 'Failed to load skill categories');
    res.json({ data: data ?? [] });
  })
);

// POST /api/gigs — create a gig (employers only)
gigRouter.post(
  '/',
  requireRole('employer'),
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const body = createGigSchema.parse(req.body);

    const { data, error } = await userClient(req)
      .from('gigs')
      .insert({
        employer_id: userId,
        title: body.title,
        description: body.description,
        category: body.category,
        required_skills: body.required_skills,
        location: body.location ?? null,
        is_remote: body.is_remote,
        budget_min: body.budget_min,
        budget_max: body.budget_max,
        currency: body.currency,
        deadline: new Date(body.deadline).toISOString(),
        status: 'draft',
      })
      .select(GIG_WITH_EMPLOYER)
      .single();

    assertNoDbError(error, 'Failed to create gig');
    res.status(201).json({ data });
  })
);

// GET /api/gigs — browse gigs with filters and pagination
gigRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const q = listQuerySchema.parse(req.query);
    const { from, to } = toRange(q.page, q.limit);

    let query = userClient(req)
      .from('gigs')
      .select(GIG_WITH_EMPLOYER, { count: 'exact' })
      .eq('status', q.status);

    if (q.employer_id) {
      query = query.eq('employer_id', q.employer_id === 'me' ? userId : q.employer_id);
    }
    if (q.category) query = query.eq('category', q.category);
    if (q.is_remote !== undefined) query = query.eq('is_remote', q.is_remote);
    if (q.location) query = query.ilike('location', `%${q.location}%`);

    // Budget filters treat a gig as a range and keep anything overlapping the
    // range the worker asked for.
    if (q.min_budget !== undefined) query = query.gte('budget_max', q.min_budget);
    if (q.max_budget !== undefined) query = query.lte('budget_min', q.max_budget);

    if (q.search) {
      const term = sanitizeSearchTerm(q.search);
      if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    assertNoDbError(error, 'Failed to load gigs');

    let gigs = data ?? [];

    // Employers listing their own gigs get applicant counts for the badges on
    // /app/my-gigs. One extra query for the page, rather than one per gig.
    const isOwnListing = q.employer_id === 'me' || q.employer_id === userId;
    if (isOwnListing && gigs.length > 0) {
      const gigIds = gigs.map((gig) => gig.id);
      const { data: applications } = await supabaseAdmin
        .from('applications')
        .select('gig_id')
        .in('gig_id', gigIds);

      const counts = new Map<string, number>();
      for (const row of applications ?? []) {
        counts.set(row.gig_id, (counts.get(row.gig_id) ?? 0) + 1);
      }

      gigs = gigs.map((gig) => ({ ...gig, application_count: counts.get(gig.id) ?? 0 }));
    }

    res.json({
      data: {
        gigs,
        ...buildPageMeta(count ?? 0, q.page, q.limit),
      },
    });
  })
);

// GET /api/gigs/:id — single gig with employer details
gigRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const gigId = parseGigId(req.params.id);

    // Read through the admin client: RLS hides non-open gigs from everyone but
    // the employer, which would also hide an in-progress gig from the worker
    // who was hired for it. Visibility is decided explicitly below instead.
    const { data: gig, error } = await supabaseAdmin
      .from('gigs')
      .select(GIG_WITH_EMPLOYER)
      .eq('id', gigId)
      .maybeSingle();

    assertNoDbError(error, 'Failed to load gig');
    if (!gig) throw new AppError('Gig not found', 404);

    const gigRow = gig as unknown as GigRow;
    const isOwner = gigRow.employer_id === userId;

    if (!isOwner && gigRow.status !== 'open') {
      // A worker keeps access to a gig they applied to after it leaves the feed.
      const { count: ownApplications } = await supabaseAdmin
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .eq('gig_id', gigId)
        .eq('worker_id', userId);

      if (!ownApplications) throw new AppError('Gig not found', 404);
    }

    const [employerGigs, gigApplications] = await Promise.all([
      supabaseAdmin
        .from('gigs')
        .select('id', { count: 'exact', head: true })
        .eq('employer_id', gigRow.employer_id)
        .neq('status', 'draft'),
      supabaseAdmin
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .eq('gig_id', gigId),
    ]);

    res.json({
      data: {
        ...gig,
        employer_total_gigs: employerGigs.count ?? 0,
        // Applicant volume is the employer's business only.
        ...(isOwner && { application_count: gigApplications.count ?? 0 }),
        is_owner: isOwner,
      },
    });
  })
);

// PATCH /api/gigs/:id — update a draft or open gig
gigRouter.patch(
  '/:id',
  requireRole('employer'),
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const existing = await loadOwnedGig(parseGigId(req.params.id), userId);
    assertEditableStatus(existing.status);

    const patch = updateGigSchema.parse(req.body);
    if (Object.keys(patch).length === 0) {
      throw new AppError('No fields to update', 400);
    }

    // Cross-field rules are checked against the merged result, so sending only
    // one half of the budget range is still validated against the stored half.
    const budgetMin = patch.budget_min ?? existing.budget_min;
    const budgetMax = patch.budget_max ?? existing.budget_max;
    if (budgetMin !== null && budgetMax !== null && budgetMax < budgetMin) {
      throw new AppError('budget_max must be greater than or equal to budget_min', 400);
    }
    if (patch.deadline) {
      const deadlineMs = new Date(patch.deadline).getTime();
      if (Number.isNaN(deadlineMs)) throw new AppError('Deadline must be a valid date', 400);
      if (deadlineMs <= Date.now()) throw new AppError('Deadline must be in the future', 400);
    }

    const { data, error } = await userClient(req)
      .from('gigs')
      .update({
        ...patch,
        ...(patch.deadline && { deadline: new Date(patch.deadline).toISOString() }),
      })
      .eq('id', existing.id)
      .select(GIG_WITH_EMPLOYER)
      .single();

    assertNoDbError(error, 'Failed to update gig');
    res.json({ data });
  })
);

// PATCH /api/gigs/:id/publish — move a draft gig into the feed
gigRouter.patch(
  '/:id/publish',
  requireRole('employer'),
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const existing = await loadOwnedGig(parseGigId(req.params.id), userId);

    if (existing.status === 'open') {
      throw new AppError('This gig is already published', 409);
    }
    if (existing.status !== 'draft') {
      throw new AppError(`A gig with status "${existing.status}" cannot be published`, 409);
    }

    const { data, error } = await userClient(req)
      .from('gigs')
      .update({ status: 'open' })
      .eq('id', existing.id)
      .select(GIG_WITH_EMPLOYER)
      .single();

    assertNoDbError(error, 'Failed to publish gig');
    res.json({ data });
  })
);

// DELETE /api/gigs/:id — soft delete by moving the gig to "cancelled"
gigRouter.delete(
  '/:id',
  requireRole('employer'),
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const existing = await loadOwnedGig(parseGigId(req.params.id), userId);
    assertEditableStatus(existing.status);

    const { data, error } = await userClient(req)
      .from('gigs')
      .update({ status: 'cancelled' })
      .eq('id', existing.id)
      .select(GIG_WITH_EMPLOYER)
      .single();

    assertNoDbError(error, 'Failed to cancel gig');
    res.json({ data });
  })
);
