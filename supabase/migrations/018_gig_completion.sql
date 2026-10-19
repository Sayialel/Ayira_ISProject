-- Let a gig reach 'completed', and so let the review loop close.
--
-- The gig lifecycle had a dead end. `accept_application()` moves a gig from
-- 'open' to 'in_progress', and nothing anywhere moved it further: 'completed'
-- appeared only in reads that count finished work. Every such count was
-- therefore permanently zero.
--
-- That blocked more than a status badge. The reviews INSERT policy added in
-- migration 012 requires `g.status = 'completed'`, so no review could ever be
-- written; `update_reputation()` had nothing to average; and because the
-- matching engine now scores the *employer's* reputation (migration 017), the
-- signal was pinned to its neutral prior for every gig on the platform. The
-- chain is only as good as its weakest link, and the missing link was here:
--
--   open -> in_progress -> [completed] -> review -> reputation -> matching
--
-- Two ways in, because both happen in practice:
--
--   1. The employer releases escrow. Paying for the work is the strongest
--      statement that it was delivered, so release completes the gig in the
--      same transaction.
--   2. The employer marks it complete directly, for gigs settled outside
--      escrow. Escrow is optional, and a gig paid in cash must still be
--      reviewable.

-- ---------------------------------------------------------------------------
-- 1. Completing a gig
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_gig(
  p_gig_id UUID,
  p_actor_id UUID
)
RETURNS public.gigs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gig public.gigs;
  v_is_admin BOOLEAN;
  v_worker_count INT;
BEGIN
  SELECT * INTO v_gig FROM public.gigs WHERE id = p_gig_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gig not found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT (role = 'admin') INTO v_is_admin FROM public.users WHERE id = p_actor_id;
  v_is_admin := coalesce(v_is_admin, false);

  -- The worker cannot complete the gig they were hired for. Otherwise a worker
  -- could declare their own work finished and unlock a review of the employer
  -- without the employer ever agreeing it was done.
  IF NOT (v_gig.employer_id = p_actor_id OR v_is_admin) THEN
    RAISE EXCEPTION 'Only the employer who posted this gig can complete it'
      USING ERRCODE = 'raise_exception';
  END IF;

  IF v_gig.status = 'completed' THEN
    -- Idempotent: a double click, or escrow release arriving after a manual
    -- completion, should not be an error.
    RETURN v_gig;
  END IF;

  IF v_gig.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Only a gig in progress can be completed, and this one is %',
      v_gig.status USING ERRCODE = 'raise_exception';
  END IF;

  -- There must be someone to review. The reviews policy joins through an
  -- accepted application, so completing a gig without one would produce a
  -- finished gig that still cannot be reviewed.
  SELECT count(*) INTO v_worker_count
  FROM public.applications
  WHERE gig_id = p_gig_id AND status = 'accepted';

  IF v_worker_count = 0 THEN
    RAISE EXCEPTION 'This gig has no accepted worker, so it cannot be completed'
      USING ERRCODE = 'raise_exception';
  END IF;

  UPDATE public.gigs
     SET status = 'completed'
   WHERE id = p_gig_id
  RETURNING * INTO v_gig;

  RETURN v_gig;
END;
$$;

COMMENT ON FUNCTION public.complete_gig(UUID, UUID) IS
  'Moves an in-progress gig to completed. Employer or admin only; requires an '
  'accepted application so the gig is reviewable. Idempotent.';

-- ---------------------------------------------------------------------------
-- 2. Releasing escrow also completes the gig
-- ---------------------------------------------------------------------------
--
-- Replaces the function from migration 016, adding the gig transition. Doing it
-- here rather than in the API keeps it in the same transaction as the release:
-- a released escrow and an unfinished gig is a state nobody should be able to
-- observe, and application code can be bypassed.

CREATE OR REPLACE FUNCTION public.transition_escrow(
  p_escrow_id UUID,
  p_actor_id UUID,
  p_to_status TEXT,
  p_detail TEXT DEFAULT NULL
)
RETURNS public.escrow
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_escrow public.escrow;
  v_from TEXT;
  v_is_employer BOOLEAN;
  v_is_worker BOOLEAN;
  v_is_admin BOOLEAN;
  v_gig_status TEXT;
BEGIN
  SELECT * INTO v_escrow FROM public.escrow WHERE id = p_escrow_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow not found' USING ERRCODE = 'no_data_found';
  END IF;

  v_is_employer := v_escrow.employer_id = p_actor_id;
  v_is_worker   := v_escrow.worker_id = p_actor_id;
  SELECT (role = 'admin') INTO v_is_admin FROM public.users WHERE id = p_actor_id;
  v_is_admin := coalesce(v_is_admin, false);

  IF NOT (v_is_employer OR v_is_worker OR v_is_admin) THEN
    RAISE EXCEPTION 'Not a party to this escrow' USING ERRCODE = 'raise_exception';
  END IF;

  -- The state machine. Each arm states who may make the move and from where,
  -- so an invalid transition fails here rather than in application code that
  -- might be bypassed.
  IF p_to_status = 'released' THEN
    IF v_escrow.status = 'funded' AND v_is_employer THEN
      NULL;                                   -- the normal happy path
    ELSIF v_escrow.status = 'disputed' AND v_is_admin THEN
      NULL;                                   -- admin resolves in the worker's favour
    ELSE
      RAISE EXCEPTION 'Cannot release an escrow that is %', v_escrow.status
        USING ERRCODE = 'raise_exception';
    END IF;

  ELSIF p_to_status = 'disputed' THEN
    IF v_escrow.status <> 'funded' OR NOT (v_is_employer OR v_is_worker) THEN
      RAISE EXCEPTION 'Only a funded escrow can be disputed, by either party'
        USING ERRCODE = 'raise_exception';
    END IF;

  ELSIF p_to_status = 'refunded' THEN
    IF v_escrow.status <> 'disputed' OR NOT v_is_admin THEN
      RAISE EXCEPTION 'Only an administrator can refund a disputed escrow'
        USING ERRCODE = 'raise_exception';
    END IF;

  ELSIF p_to_status = 'cancelled' THEN
    IF v_escrow.status <> 'pending' OR NOT (v_is_employer OR v_is_admin) THEN
      RAISE EXCEPTION 'Only an unpaid escrow can be cancelled'
        USING ERRCODE = 'raise_exception';
    END IF;

  ELSE
    RAISE EXCEPTION 'Unsupported transition to %', p_to_status
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Captured before the update, which overwrites v_escrow with the new row.
  v_from := v_escrow.status;

  UPDATE public.escrow
     SET status = p_to_status,
         released_at = CASE WHEN p_to_status = 'released' THEN now() ELSE released_at END
   WHERE id = v_escrow.id
  RETURNING * INTO v_escrow;

  INSERT INTO public.escrow_events (escrow_id, from_status, to_status, actor_id, detail)
  VALUES (p_escrow_id, v_from, p_to_status, p_actor_id, p_detail);

  -- Paying for the work completes the gig, which is what makes it reviewable.
  --
  -- Guarded rather than assumed: only from 'in_progress', because an admin
  -- releasing a disputed escrow on a gig that was already cancelled must not
  -- quietly resurrect it as finished work.
  IF p_to_status = 'released' THEN
    SELECT status INTO v_gig_status
    FROM public.gigs WHERE id = v_escrow.gig_id FOR UPDATE;

    IF v_gig_status = 'in_progress' THEN
      UPDATE public.gigs SET status = 'completed' WHERE id = v_escrow.gig_id;

      INSERT INTO public.escrow_events (escrow_id, from_status, to_status, actor_id, detail)
      VALUES (
        p_escrow_id, v_from, p_to_status, p_actor_id,
        'Gig marked completed because escrow was released'
      );
    END IF;
  END IF;

  RETURN v_escrow;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Only the server may call these
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.complete_gig(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_gig(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.transition_escrow(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_escrow(UUID, UUID, TEXT, TEXT) TO service_role;
