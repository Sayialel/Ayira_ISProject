-- Say which rule was broken, rather than naming only one of two.
--
-- transition_escrow tested status and role in a single condition and raised a
-- message about the role:
--
--   IF v_escrow.status <> 'disputed' OR NOT v_is_admin THEN
--     RAISE EXCEPTION 'Only an administrator can refund a disputed escrow';
--
-- So an administrator settling an already-settled dispute was told "only an
-- administrator can refund a disputed escrow". The guard was right and the
-- explanation was wrong, which in a path that moves money is worse than it
-- sounds: the obvious reading is that your account lacks a permission, and the
-- obvious next step is to go looking for one rather than to re-read the
-- current state.
--
-- Observed while testing dispute resolution end to end: resolving the same
-- escrow twice returned that message to an account whose role is admin.
--
-- The arms now test the two things separately and say which failed. Nothing
-- about who may do what changes.

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

  IF p_to_status = 'released' THEN
    IF v_escrow.status = 'funded' AND v_is_employer THEN
      NULL;                                   -- the normal happy path
    ELSIF v_escrow.status = 'disputed' AND v_is_admin THEN
      NULL;                                   -- admin resolves in the worker's favour
    ELSIF v_escrow.status NOT IN ('funded', 'disputed') THEN
      RAISE EXCEPTION 'Only a funded or disputed escrow can be released, and this one is %',
        v_escrow.status USING ERRCODE = 'raise_exception';
    ELSIF v_escrow.status = 'funded' THEN
      RAISE EXCEPTION 'Only the employer who funded this escrow can release it'
        USING ERRCODE = 'raise_exception';
    ELSE
      RAISE EXCEPTION 'Only an administrator can release a disputed escrow'
        USING ERRCODE = 'raise_exception';
    END IF;

  ELSIF p_to_status = 'disputed' THEN
    IF v_escrow.status <> 'funded' THEN
      RAISE EXCEPTION 'Only a funded escrow can be disputed, and this one is %',
        v_escrow.status USING ERRCODE = 'raise_exception';
    ELSIF NOT (v_is_employer OR v_is_worker) THEN
      RAISE EXCEPTION 'Only the employer or the worker can dispute this escrow'
        USING ERRCODE = 'raise_exception';
    END IF;

  ELSIF p_to_status = 'refunded' THEN
    IF v_escrow.status <> 'disputed' THEN
      RAISE EXCEPTION 'Only a disputed escrow can be refunded, and this one is %',
        v_escrow.status USING ERRCODE = 'raise_exception';
    ELSIF NOT v_is_admin THEN
      RAISE EXCEPTION 'Only an administrator can refund a disputed escrow'
        USING ERRCODE = 'raise_exception';
    END IF;

  ELSIF p_to_status = 'cancelled' THEN
    IF v_escrow.status <> 'pending' THEN
      RAISE EXCEPTION 'Only an escrow that has not been paid can be cancelled, and this one is %',
        v_escrow.status USING ERRCODE = 'raise_exception';
    ELSIF NOT (v_is_employer OR v_is_admin) THEN
      RAISE EXCEPTION 'Only the employer or an administrator can cancel this escrow'
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
  -- Guarded to 'in_progress' so an admin releasing a disputed escrow cannot
  -- resurrect a cancelled gig as finished work.
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

REVOKE ALL ON FUNCTION public.transition_escrow(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_escrow(UUID, UUID, TEXT, TEXT) TO service_role;
