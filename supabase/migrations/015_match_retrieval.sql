-- Retrieval for the matching engine: find the gigs worth scoring, and find the
-- ones whose embeddings need (re)building.
--
-- Addresses H-04 (embeddings recomputed per request), M-04 (budget and
-- category ignored), M-05 (expired gigs still ranked) and M-07 (workers shown
-- gigs they already applied to). Filtering in SQL means the engine only ever
-- scores plausible candidates, instead of scoring everything and discarding.

-- ---------------------------------------------------------------------------
-- Gigs whose stored embedding is missing or stale
-- ---------------------------------------------------------------------------
--
-- The engine hashes the text it is about to embed and compares it with the
-- hash recorded alongside the vector, so an edited gig is re-embedded and an
-- untouched one is left alone.

CREATE OR REPLACE FUNCTION public.gigs_needing_embedding(p_limit INT DEFAULT 500)
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  required_skills TEXT[],
  embedding_hash TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.id, g.title, g.description, g.required_skills, g.embedding_hash
  FROM public.gigs g
  WHERE g.status = 'open'
    AND (g.deadline IS NULL OR g.deadline > now())
  ORDER BY (g.embedding IS NULL) DESC, g.updated_at DESC
  LIMIT p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Candidate gigs for one worker, nearest first
-- ---------------------------------------------------------------------------
--
-- Everything excluded here is something the engine would otherwise have paid
-- to score and then thrown away:
--
--   * gigs that are not open,
--   * gigs whose deadline has passed but which nobody has closed,
--   * gigs the worker has already applied to — the most visible quality
--     complaint the feature had,
--   * the worker's own gigs, if they also post work.
--
-- Ordering is by vector distance, so the LIMIT keeps the semantically closest
-- candidates. The engine then re-ranks that shortlist with the full composite,
-- which is bounded work regardless of how large the catalogue grows.
--
-- Gigs without an embedding are still returned, ranked last, so a catalogue
-- that has not finished backfilling degrades rather than disappears.

CREATE OR REPLACE FUNCTION public.nearest_open_gigs(
  p_worker_id UUID,
  p_embedding vector(384),
  p_limit INT DEFAULT 200,
  p_category TEXT DEFAULT NULL,
  p_max_budget NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  required_skills TEXT[],
  location TEXT,
  is_remote BOOLEAN,
  distance REAL
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id,
    g.title,
    g.description,
    g.required_skills,
    g.location,
    g.is_remote,
    CASE
      WHEN g.embedding IS NULL THEN NULL
      ELSE (g.embedding <=> p_embedding)::real
    END AS distance
  FROM public.gigs g
  WHERE g.status = 'open'
    AND (g.deadline IS NULL OR g.deadline > now())
    AND g.employer_id <> p_worker_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.applications a
      WHERE a.gig_id = g.id
        AND a.worker_id = p_worker_id
    )
    AND (p_category IS NULL OR g.category = p_category)
    AND (p_max_budget IS NULL OR g.budget_min IS NULL OR g.budget_min <= p_max_budget)
  -- NULLS LAST keeps un-embedded gigs from crowding out scored ones.
  ORDER BY (g.embedding <=> p_embedding) NULLS LAST
  LIMIT p_limit;
$$;

-- Both functions are SECURITY DEFINER and bypass RLS, so only the engine's
-- service role may call them.
REVOKE ALL ON FUNCTION public.gigs_needing_embedding(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gigs_needing_embedding(INT) TO service_role;

REVOKE ALL ON FUNCTION public.nearest_open_gigs(UUID, vector, INT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nearest_open_gigs(UUID, vector, INT, TEXT, NUMERIC) TO service_role;
