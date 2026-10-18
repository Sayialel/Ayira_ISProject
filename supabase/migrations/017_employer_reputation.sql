-- Make the reputation signal able to affect a ranking.
--
-- The matching composite weighted "reputation", but the engine was reading the
-- *worker's* own reputation_score. That value is identical for every candidate
-- gig in a request, so it shifted all of a worker's scores by the same amount
-- and could not reorder any of them: the term cost a weight and bought
-- nothing. Verified before changing it -- two weight sets differing only in
-- the reputation coefficient produced identical top-10 rankings for all 47
-- evaluation profiles.
--
-- The signal a worker would actually use is the reputation of the *employer*
-- who posted the gig, which varies from gig to gig. The reviews table and the
-- update_reputation() trigger already support this: the trigger keys on
-- reviewee_id, so an employer reviewed by a worker already accrues a score.
-- Nothing new needs storing; the retrieval function simply has to return it.
--
-- Also returns the employer's review count, because reputation_score is 0.00
-- both for "nobody has reviewed them" and for "every review was one star". A
-- rating of 0 is not reachable on a 1-5 scale, so without the count the engine
-- cannot tell a brand-new employer from a terrible one, and would rank every
-- new employer at the bottom. app/services/scoring.employer_reputation()
-- maps the unreviewed case to a neutral prior.

-- The return type changes, so the function must be dropped rather than
-- replaced in place.
DROP FUNCTION IF EXISTS public.nearest_open_gigs(UUID, vector, INT, TEXT, NUMERIC);

CREATE FUNCTION public.nearest_open_gigs(
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
  employer_reputation NUMERIC,
  employer_review_count BIGINT,
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
    e.reputation_score AS employer_reputation,
    -- Counted from reviews rather than trusted from a cached column, so a
    -- score of 0 can be told apart from an absence of reviews.
    (
      SELECT count(*)
      FROM public.reviews r
      WHERE r.reviewee_id = g.employer_id
    ) AS employer_review_count,
    CASE
      WHEN g.embedding IS NULL THEN NULL
      ELSE (g.embedding <=> p_embedding)::real
    END AS distance
  FROM public.gigs g
  -- INNER JOIN would be wrong here: employer_id is NOT NULL and references
  -- users, but a LEFT JOIN means a future soft-delete of an employer degrades
  -- to an unknown reputation instead of making their gigs vanish from search.
  LEFT JOIN public.users e ON e.id = g.employer_id
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

-- SECURITY DEFINER bypasses RLS, so only the engine's service role may call it.
REVOKE ALL ON FUNCTION public.nearest_open_gigs(UUID, vector, INT, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nearest_open_gigs(UUID, vector, INT, TEXT, NUMERIC)
  TO service_role;
