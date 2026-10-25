-- Make partial_release reachable, and record what it paid.
--
-- 'partial_release' has been in the status CHECK since migration 004. It is
-- counted in the administrator's active-escrow total, accepted by the escrow
-- route's validator, and has a badge and a label in the web UI. Nothing could
-- ever set it: transition_escrow handles released, disputed, refunded and
-- cancelled, and raises 'Unsupported transition to %' for anything else. So
-- the API would accept the request and the database would reject it.
--
-- That is worth fixing rather than deleting, because splitting the money is
-- the outcome most disputes actually need. Until now an administrator settling
-- a dispute over half-finished work had to choose between paying in full and
-- refunding in full, and neither is true. The dispute screen had two buttons
-- where the honest answer needed three.
--
-- A partial release also needs a figure, and the table had nowhere to put one:
-- 'amount' is what the employer funded, and after a 60/40 split the row would
-- have said the worker was paid the whole amount. Hence released_amount.

-- ---------------------------------------------------------------------------
-- 1. How much actually reached the worker
-- ---------------------------------------------------------------------------

ALTER TABLE public.escrow
  ADD COLUMN IF NOT EXISTS released_amount NUMERIC(10,2);

COMMENT ON COLUMN public.escrow.released_amount IS
  'What the worker was paid. Equal to amount on a full release, between 0 and '
  'amount on a partial_release, and NULL while nothing has been paid out. The '
  'employer''s refund on a partial release is amount - released_amount.';

-- Set on full releases too, not just partial ones, so "what did the worker
-- get" is one column that is always the answer. Reading it as
-- `CASE status WHEN 'released' THEN amount ELSE released_amount END`
-- everywhere would be a trap waiting for whoever forgets the CASE.
UPDATE public.escrow
   SET released_amount = amount
 WHERE status = 'released'
   AND released_amount IS NULL;

-- The guard that matters: money out can never exceed money in, and can never
-- be negative. Enforced on the table rather than only in the function, so it
-- holds for a manual correction or a future caller as well.
ALTER TABLE public.escrow
  DROP CONSTRAINT IF EXISTS escrow_released_amount_range;

ALTER TABLE public.escrow
  ADD CONSTRAINT escrow_released_amount_range CHECK (
    released_amount IS NULL
    OR (released_amount > 0 AND released_amount <= amount)
  );

-- ---------------------------------------------------------------------------
-- 2. transition_escrow, now with a fifth state and an amount
-- ---------------------------------------------------------------------------
--
-- The four-argument version is dropped rather than left in place. Adding
-- p_amount with a DEFAULT alongside it would make every existing four-argument
-- call ambiguous between the two overloads, which Postgres rejects at call
-- time -- so keeping the old one to be safe would break every caller instead.
-- With it gone, four-argument calls bind to this function and p_amount
-- defaults to NULL, which is what every transition except a partial release
-- wants.

DROP FUNCTION IF EXISTS public.transition_escrow(UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.transition_escrow(
  p_escrow_id UUID,
  p_actor_id UUID,
  p_to_status TEXT,
  p_detail TEXT DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL
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
  v_pays_worker BOOLEAN;
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

  ELSIF p_to_status = 'partial_release' THEN
    -- Only out of a dispute, and only by an administrator. There is no
    -- employer-driven partial release: an employer who wants to pay less than
    -- they committed has a disagreement, and a disagreement is a dispute.
    IF v_escrow.status <> 'disputed' THEN
      RAISE EXCEPTION 'Only a disputed escrow can be split, and this one is %',
        v_escrow.status USING ERRCODE = 'raise_exception';
    ELSIF NOT v_is_admin THEN
      RAISE EXCEPTION 'Only an administrator can split a disputed escrow'
        USING ERRCODE = 'raise_exception';
    ELSIF p_amount IS NULL THEN
      RAISE EXCEPTION 'A partial release needs the amount to pay the worker'
        USING ERRCODE = 'raise_exception';
    ELSIF p_amount <= 0 THEN
      -- Nothing to the worker is a refund, and it has its own status. Letting
      -- it through here would leave two different statuses describing one
      -- outcome, and any report grouping by status would disagree with itself.
      RAISE EXCEPTION 'Paying the worker nothing is a refund, not a split'
        USING ERRCODE = 'raise_exception';
    ELSIF p_amount >= v_escrow.amount THEN
      RAISE EXCEPTION 'Paying the worker the full % is a release, not a split',
        v_escrow.amount USING ERRCODE = 'raise_exception';
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

  -- Both of these move money to the worker, and from here on the two are
  -- treated alike: both stamp released_at, both complete the gig.
  v_pays_worker := p_to_status IN ('released', 'partial_release');

  UPDATE public.escrow
     SET status = p_to_status,
         released_at = CASE WHEN v_pays_worker THEN now() ELSE released_at END,
         released_amount = CASE
           WHEN p_to_status = 'released' THEN v_escrow.amount
           WHEN p_to_status = 'partial_release' THEN p_amount
           ELSE released_amount
         END
   WHERE id = v_escrow.id
  RETURNING * INTO v_escrow;

  INSERT INTO public.escrow_events (escrow_id, from_status, to_status, actor_id, detail)
  VALUES (p_escrow_id, v_from, p_to_status, p_actor_id, p_detail);

  -- Paying for the work completes the gig, which is what makes it reviewable.
  -- A split counts: the engagement is over and both sides should be able to
  -- say how it went -- arguably more so than when it went smoothly.
  --
  -- Guarded to 'in_progress' so an admin settling a disputed escrow cannot
  -- resurrect a cancelled gig as finished work.
  IF v_pays_worker THEN
    SELECT status INTO v_gig_status
    FROM public.gigs WHERE id = v_escrow.gig_id FOR UPDATE;

    IF v_gig_status = 'in_progress' THEN
      UPDATE public.gigs SET status = 'completed' WHERE id = v_escrow.gig_id;

      INSERT INTO public.escrow_events (escrow_id, from_status, to_status, actor_id, detail)
      VALUES (
        p_escrow_id, v_from, p_to_status, p_actor_id,
        'Gig marked completed because escrow was ' ||
        CASE WHEN p_to_status = 'partial_release' THEN 'split' ELSE 'released' END
      );
    END IF;
  END IF;

  RETURN v_escrow;
END;
$$;

COMMENT ON FUNCTION public.transition_escrow(UUID, UUID, TEXT, TEXT, NUMERIC) IS
  'The escrow state machine. p_amount is required for partial_release and '
  'ignored otherwise.';

REVOKE ALL ON FUNCTION public.transition_escrow(UUID, UUID, TEXT, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_escrow(UUID, UUID, TEXT, TEXT, NUMERIC)
  TO service_role;
