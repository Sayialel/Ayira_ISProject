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
    // A number, not a boolean, since migration-era location tiering: the
    // engine returns an affinity (same town 1.0, same county 0.6, same metro
    // 0.45, unknown 0.3, different county 0.0) rather than a yes/no.
    location: z.number().optional(),
    // The *employer's* reputation, not the worker's. The engine used to score
    // the worker's own, which is identical for every candidate gig and so
    // could not affect the ranking at all.
    employer_reputation: z.number().optional(),
  }),
});

/**
 * How much of the ranking the worker's own profile could drive.
 *
 * Optional, so a gateway deployed ahead of the engine still parses a response
 * from an engine that does not send it yet.
 */
const sufficiencySchema = z.object({
  // 'degraded' means the ranking ran without the semantic signal because
  // the worker has no cached vector yet. Still a usable result.
  level: z.enum(['ok', 'weak', 'degraded', 'insufficient']),
  reason: z.string(),
  skills: z.number(),
  has_bio: z.boolean(),
});

const matchResponseSchema = z.object({
  worker_id: z.string(),
  matches: z.array(gigScoreSchema),
  sufficiency: sufficiencySchema.nullish(),
});

type GigScore = z.infer<typeof gigScoreSchema>;

const GIG_FIELDS =
  'id, title, description, category, required_skills, location, is_remote, budget_min, budget_max, currency, deadline, status, employer:users!employer_id(id, full_name, avatar_url, is_verified)';

/**
 * Statuses that mean "the engine is not ready yet", rather than "the engine
 * said no".
 *
 * On a host that sleeps when idle -- which the free tier does, after about
 * fifteen minutes -- the platform's own proxy answers these while the
 * container starts. They are transient by definition, so they are worth
 * waiting through rather than reporting as a failure.
 */
const WAKING_STATUSES = new Set([502, 503, 504]);

/** Waits between attempts while the engine starts. Total added wait: 25s. */
const WAKE_BACKOFF_MS = [5_000, 20_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callAiEngine(workerId: string, limit: number) {
  if (!env.aiEngineSecret) {
    // Fail here rather than letting the engine reject the call, so the message
    // names the actual problem.
    console.error('AI_ENGINE_SECRET is not set — cannot authenticate to the AI engine.');
    throw new AppError('Matching is not configured on this server.', 503);
  }

  // A cold engine is the normal case on a sleeping host, not an error. The
  // first attempt usually wakes it and the retry finds it ready; without
  // this, the very first match after a quiet period always failed and the
  // worker was told their profile could not be scored -- which blamed the
  // profile for an idle container.
  let lastStatus = 0;

  for (let attempt = 0; attempt <= WAKE_BACKOFF_MS.length; attempt++) {
    let response: Response;

    try {
      response = await fetch(`${AI_ENGINE_URL}/ai/match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ayira-Key': env.aiEngineSecret,
        },
        body: JSON.stringify({ worker_id: workerId, limit }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
    } catch (err) {
      // Connection refused, DNS failure or the timeout above. Also worth one
      // retry: a host that is still booting refuses the connection outright.
      console.error(`AI engine request failed (attempt ${attempt + 1}):`, err);
      if (attempt < WAKE_BACKOFF_MS.length) {
        await sleep(WAKE_BACKOFF_MS[attempt]);
        continue;
      }
      throw new AppError(
        'The matching service is starting up. Give it a moment and try again.',
        503
      );
    }

    if (response.ok) {
      const parsed = matchResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        console.error('Unexpected AI engine payload:', parsed.error.message);
        throw new AppError('The matching service returned an unexpected response.', 502);
      }
      return parsed.data;
    }

    lastStatus = response.status;
    const detail = await response.text().catch(() => '');
    console.error(
      `AI engine returned ${response.status} (attempt ${attempt + 1}):`,
      detail.slice(0, 500)
    );

    // Anything that is not a waking status is a real refusal -- a bad secret,
    // a malformed request -- and retrying it would only delay the error.
    if (!WAKING_STATUSES.has(response.status)) {
      throw new AppError('The matching service could not score your profile right now.', 502);
    }

    if (attempt < WAKE_BACKOFF_MS.length) {
      await sleep(WAKE_BACKOFF_MS[attempt]);
    }
  }

  // Still waking after every attempt. Say so, because "could not score your
  // profile" blames the profile for a service that is merely cold.
  console.error(`AI engine never became ready; last status ${lastStatus}`);
  throw new AppError(
    'The matching service is still starting up. Please try again in a minute.',
    503
  );
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
      location_affinity: match.breakdown.location ?? null,
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
      return res.json({
        data: {
          matches: [],
          sufficiency: result.sufficiency ?? null,
          generated_at: new Date().toISOString(),
        },
      });
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

    res.json({
      data: {
        matches,
        sufficiency: result.sufficiency ?? null,
        generated_at: new Date().toISOString(),
      },
    });
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
