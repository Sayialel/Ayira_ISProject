-- Let a worker see the gigs they worked on.
--
-- The SELECT policy on gigs, unchanged since migration 002, was:
--
--   USING (status = 'open' OR employer_id = auth.uid())
--
-- So a gig became invisible to the worker the moment it stopped being open.
-- Completing a gig hid it from the only person other than the employer who
-- had anything to do with it.
--
-- That is wrong on its own terms -- you should be able to see the job you were
-- hired for -- but the consequence that matters is indirect. The reviews
-- INSERT policy from migration 012 confirms the pairing with a subquery over
-- gigs and applications, and a subquery inside a policy is itself subject to
-- RLS. With the gig invisible, the EXISTS found nothing, and the insert was
-- refused with "new row violates row-level security policy".
--
-- The effect: **a worker could never review an employer.** The employer could
-- review the worker, because employer_id = auth.uid() kept their own gig
-- visible to them. Reviews only ever flowed one way.
--
-- Which quietly disabled the signal migrations 017 and 019 exist to serve.
-- Employer reputation is computed from reviews written about the employer, and
-- those can only come from workers. No worker could write one, so in real use
-- every employer would have sat at the neutral prior forever. The seeded
-- reviews hid this, because eval/seed_db.py writes as the service role, which
-- bypasses RLS entirely.
--
-- Found by running the journey through the API as the two real accounts
-- instead of as the service role: the employer's review succeeded and the
-- worker's was refused on the same completed gig.

-- ---------------------------------------------------------------------------
-- 1. Participation check that does not recurse
-- ---------------------------------------------------------------------------
--
-- The policy cannot simply query applications: the SELECT policy on
-- applications itself queries gigs, so gigs -> applications -> gigs is
-- infinite recursion, which Postgres refuses at query time.
--
-- SECURITY DEFINER runs the lookup as the function owner, so RLS on
-- applications does not apply and the cycle is broken. It answers one narrow
-- question and returns a boolean, so it leaks nothing a caller could not
-- already establish about their own applications.

CREATE OR REPLACE FUNCTION public.has_application_on_gig(
  p_gig_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.applications a
    WHERE a.gig_id = p_gig_id
      AND a.worker_id = p_user_id
  );
$$;

COMMENT ON FUNCTION public.has_application_on_gig(UUID, UUID) IS
  'Whether this user has applied to this gig. SECURITY DEFINER so the gigs '
  'SELECT policy can call it without recursing through the applications policy.';

-- ---------------------------------------------------------------------------
-- 2. The policy
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can view open gigs" ON public.gigs;

CREATE POLICY "Open gigs, your own gigs, and gigs you applied to"
  ON public.gigs FOR SELECT
  USING (
    status = 'open'
    OR employer_id = auth.uid()
    -- Applying is what grants continued visibility. A worker who applied can
    -- follow what became of that application: whether the gig was filled,
    -- finished or cancelled. Without it, a rejected or completed gig vanishes
    -- from their history with no explanation.
    OR public.has_application_on_gig(id, auth.uid())
  );

-- Callers reach this only through the policy; it is not a general-purpose
-- lookup and nothing should call it directly.
REVOKE ALL ON FUNCTION public.has_application_on_gig(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_application_on_gig(UUID, UUID)
  TO authenticated, service_role;
