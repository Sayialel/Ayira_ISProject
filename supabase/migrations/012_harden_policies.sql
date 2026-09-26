-- Block 1 of the engineering review: close the findings that let a user forge
-- data, and make hiring atomic.
--
-- Addresses C-02 (reputation forgeable), C-03 (match logs world-writable),
-- C-04 (accepting an applicant is not atomic) and M-01 (users insert policy
-- too permissive).

-- ---------------------------------------------------------------------------
-- C-02 — reviews may only be written by people who worked together
-- ---------------------------------------------------------------------------
--
-- The previous policy checked only that you were who you claimed to be, so any
-- user could review any other user on any gig. Because update_reputation()
-- folds every review into reputation_score, and reputation is 15% of the match
-- formula, that made the ranking signal forgeable.
--
-- A review is now allowed only when all of the following hold:
--   * the reviewer is the caller,
--   * reviewer and reviewee are different people,
--   * the gig is completed,
--   * and the two parties are the gig's employer and its hired worker.

DROP POLICY IF EXISTS "Parties can write reviews" ON public.reviews;

CREATE POLICY "Gig participants can review each other"
  ON public.reviews FOR INSERT
  WITH CHECK (
    auth.uid() = reviewer_id
    AND reviewer_id <> reviewee_id
    AND EXISTS (
      SELECT 1
      FROM public.gigs g
      JOIN public.applications a
        ON a.gig_id = g.id
       AND a.status = 'accepted'
      WHERE g.id = reviews.gig_id
        AND g.status = 'completed'
        AND (
          -- employer reviewing the worker they hired
          (g.employer_id = auth.uid() AND a.worker_id = reviews.reviewee_id)
          -- or the hired worker reviewing the employer
          OR (a.worker_id = auth.uid() AND g.employer_id = reviews.reviewee_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- C-03 — nobody may hand-write match logs
-- ---------------------------------------------------------------------------
--
-- "WITH CHECK (true)" let any signed-in user POST fabricated scores straight to
-- the REST endpoint using the public anon key. This table is the evidence base
-- for evaluating match quality, so it has to be trustworthy.
--
-- Dropping the policy leaves no INSERT policy at all, which denies inserts to
-- every ordinary role. The API gateway writes with the service-role key, which
-- bypasses RLS entirely and is therefore unaffected.

DROP POLICY IF EXISTS "Service can insert" ON public.ai_match_logs;

-- ---------------------------------------------------------------------------
-- M-01 — a user may only insert their own profile row
-- ---------------------------------------------------------------------------
--
-- The signup trigger is SECURITY DEFINER and the signup route uses the
-- service-role key, so neither relies on this policy.

DROP POLICY IF EXISTS "Service role can insert" ON public.users;

CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- C-04 — hiring an applicant happens in one transaction
-- ---------------------------------------------------------------------------
--
-- Acceptance performs three writes: mark this application accepted, move the
-- gig to in_progress, reject the remaining applicants. Run separately from the
-- API they can half-succeed, leaving a gig that has hired someone but is still
-- open, or rival applications left pending forever.
--
-- A function runs inside a single transaction, so the whole operation either
-- happens or does not. SELECT ... FOR UPDATE also serialises two employers
-- clicking Accept on different applicants at the same moment.

CREATE OR REPLACE FUNCTION public.accept_application(p_application_id UUID)
RETURNS public.applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.applications;
  v_gig public.gigs;
BEGIN
  SELECT * INTO v_app
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_gig
  FROM public.gigs
  WHERE id = v_app.gig_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gig not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_app.status NOT IN ('pending', 'shortlisted') THEN
    RAISE EXCEPTION 'Application is already %', v_app.status
      USING ERRCODE = 'raise_exception';
  END IF;

  IF v_gig.status <> 'open' THEN
    RAISE EXCEPTION 'Gig is % and can no longer hire', v_gig.status
      USING ERRCODE = 'raise_exception';
  END IF;

  UPDATE public.applications
     SET status = 'accepted'
   WHERE id = v_app.id
  RETURNING * INTO v_app;

  UPDATE public.gigs
     SET status = 'in_progress'
   WHERE id = v_gig.id;

  UPDATE public.applications
     SET status = 'rejected'
   WHERE gig_id = v_gig.id
     AND id <> v_app.id
     AND status IN ('pending', 'shortlisted');

  RETURN v_app;
END;
$$;

-- The function is SECURITY DEFINER, so it ignores RLS. Only the gateway may
-- call it — it verifies that the caller owns the gig before doing so. Leaving
-- it callable by signed-in users would let anyone hire anyone.
REVOKE ALL ON FUNCTION public.accept_application(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_application(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.accept_application(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.accept_application(UUID) TO service_role;
