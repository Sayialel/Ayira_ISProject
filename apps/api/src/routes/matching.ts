import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { env } from '../lib/env';
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
} from '../lib/http';

export const matchingRouter = Router();

const AI_ENGINE_URL = env.aiEngineUrl;

// The first request after a cold start pays for loading the Sentence-BERT
// model, which is far slower than steady-state scoring.
const AI_TIMEOUT_MS = Number(process.env.AI_ENGINE_TIMEOUT_MS || 60_000);

const matchRequestSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
});

/** Shape returned by the FastAPI engine (app/models/schemas.py). */
const gigScoreSchema = z.object({
  gig_id: z.string(),
  title: z.string(),
  score: z.number(),
  breakdown: z.object({
    semantic: z.number().optional(),
    tfidf: z.number().optional(),
    location: z.boolean().optional(),
    reputation: z.number().optional(),
  }),
});

const matchResponseSchema = z.object({
  worker_id: z.string(),
  matches: z.array(gigScoreSchema),
});

type GigScore = z.infer<typeof gigScoreSchema>;

const GIG_FIELDS =
  'id, title, description, category, required_skills, location, is_remote, budget_min, budget_max, currency, deadline, status, employer:users!employer_id(id, full_name, avatar_url, is_verified)';

async function callAiEngine(workerId: string, limit: number) {
  let response: Response;

  try {
    response = await fetch(`${AI_ENGINE_URL}/ai/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: workerId, limit }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (err) {
    // Connection refused, DNS failure or the timeout above.
    console.error('AI engine request failed:', err);
    throw new AppError('The matching service is unavailable. Please try again shortly.', 503);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error(`AI engine returned ${response.status}:`, detail.slice(0, 500));
    throw new AppError('The matching service could not score your profile right now.', 502);
  }

  const parsed = matchResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    console.error('Unexpected AI engine payload:', parsed.error.message);
    throw new AppError('The matching service returned an unexpected response.', 502);
  }

  return parsed.data;
}

/** Records each scored gig so match quality can be analysed later. */
async function logMatches(workerId: string, matches: GigScore[]) {
  if (matches.length === 0) return;

  const { error } = await supabaseAdmin.from('ai_match_logs').insert(
    matches.map((match) => ({
      worker_id: workerId,
      gig_id: match.gig_id,
      semantic_score: match.breakdown.semantic ?? null,
      tfidf_score: match.breakdown.tfidf ?? null,
      location_match: match.breakdown.location ?? null,
      composite_score: match.score,
    }))
  );

  // Logging is analytics, not the user's result — never fail the request on it.
  if (error) console.error('Failed to write ai_match_logs:', error.message);
}

// POST /api/match — score open gigs against the calling worker's profile
matchingRouter.post(
  '/',
  requireRole('worker'),
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const { limit } = matchRequestSchema.parse(req.body ?? {});

    const result = await callAiEngine(userId, limit);

    if (result.matches.length === 0) {
      return res.json({ data: { matches: [], generated_at: new Date().toISOString() } });
    }

    // The engine returns scores only; hydrate them with the gig fields the
    // match cards need, keeping the ranking the engine produced.
    const { data: gigs, error } = await supabaseAdmin
      .from('gigs')
      .select(GIG_FIELDS)
      .in(
        'id',
        result.matches.map((m) => m.gig_id)
      );

    assertNoDbError(error, 'Failed to load matched gigs');

    const gigsById = new Map((gigs ?? []).map((gig) => [gig.id, gig]));
    const matches = result.matches
      .map((match) => {
        const gig = gigsById.get(match.gig_id);
        if (!gig) return null;
        return {
          gig,
          score: match.score,
          score_percent: Math.round(match.score * 100),
          breakdown: match.breakdown,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    await logMatches(userId, result.matches);

    res.json({ data: { matches, generated_at: new Date().toISOString() } });
  })
);

// GET /api/match/history — the worker's previous match runs
matchingRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const q = paginationSchema.parse(req.query);
    const { from, to } = toRange(q.page, q.limit);

    const { data, error, count } = await userClient(req)
      .from('ai_match_logs')
      .select('*, gig:gigs!gig_id(id, title, category, status, budget_min, budget_max, currency)', {
        count: 'exact',
      })
      .eq('worker_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    assertNoDbError(error, 'Failed to load match history');

    res.json({
      data: { logs: data ?? [], ...buildPageMeta(count ?? 0, q.page, q.limit) },
    });
  })
);
