-- Phase 4 groundwork: make escrow state changeable only by the server, record
-- every transition, and enforce the state machine in the database.
--
-- Migration 004 gave employers INSERT and UPDATE on their own escrow rows.
-- Because the anon key is public, that let an employer PATCH the REST endpoint
-- directly and set status = 'released' — or 'funded' — without any payment
-- ever happening. On the money path that is the most serious of the policy
-- gaps found in this project.
--
-- Escrow is now read-only to clients. Every mutation goes through the
-- functions below, which the API gateway calls with the service role after
-- checking who is asking.

-- ---------------------------------------------------------------------------
-- 1. Clients may read their own escrow, and nothing more
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Employers can create escrow" ON public.escrow;
DROP POLICY IF EXISTS "Employers can update escrow" ON public.escrow;

-- "Parties can view own escrow" from migration 004 is kept as-is: both sides
-- of a transaction need to see it.

-- ---------------------------------------------------------------------------
-- 2. An audit trail
-- ---------------------------------------------------------------------------
--
-- Money needs a history, not just a current value. Every transition records
-- what changed, who caused it and why, so a disputed payment can be
-- reconstructed rather than argued about.

CREATE TABLE IF NOT EXISTS public.escrow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES public.escrow(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id UUID REFERENCES public.users(id),
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS escrow_events_escrow_id_idx
  ON public.escrow_events (escrow_id, created_at DESC);

ALTER TABLE public.escrow_events ENABLE ROW LEVEL SECURITY;

-- Readable by the two parties to the escrow it belongs to. No INSERT policy at
-- all: only the service role writes here, and it bypasses RLS.
CREATE POLICY "Parties can read escrow history"
  ON public.escrow_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.escrow e
    WHERE e.id = escrow_events.escrow_id
      AND (e.employer_id = auth.uid() OR e.worker_id = auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- 3. Opening an escrow
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.open_escrow(
  p_gig_id UUID,
  p_employer_id UUID,
  p_worker_id UUID,
  p_amount NUMERIC
)
RETURNS public.escrow
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gig public.gigs;
  v_escrow public.escrow;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero' USING ERRCODE = 'raise_exception';
  END IF;

  SELECT * INTO v_gig FROM public.gigs WHERE id = p_gig_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gig not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_gig.employer_id <> p_employer_id THEN
    RAISE EXCEPTION 'Only the employer who posted this gig can fund it'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The worker must actually have been hired for this gig. Without this an
  -- employer could open an escrow naming any user as the payee.
  IF NOT EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.gig_id = p_gig_id
      AND a.worker_id = p_worker_id
      AND a.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'That worker has not been accepted for this gig'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- One live escrow per gig. A second funding attempt while one is already
  -- open would double-charge the employer.
  IF EXISTS (
    SELECT 1 FROM public.escrow e
    WHERE e.gig_id = p_gig_id
      AND e.status IN ('pending', 'funded', 'disputed', 'partial_release')
  ) THEN
    RAISE EXCEPTION 'This gig already has an open escrow'
      USING ERRCODE = 'raise_exception';
  END IF;

  INSERT INTO public.escrow (gig_id, employer_id, worker_id, amount, status)
  VALUES (p_gig_id, p_employer_id, p_worker_id, p_amount, 'pending')
  RETURNING * INTO v_escrow;

  INSERT INTO public.escrow_events (escrow_id, from_status, to_status, actor_id, detail)
  VALUES (v_escrow.id, NULL, 'pending', p_employer_id, 'Escrow opened');

  RETURN v_escrow;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Recording a successful payment
-- ---------------------------------------------------------------------------
--
-- Called from the M-Pesa callback. Addressed by checkout id rather than escrow
-- id because that is what Safaricom sends back, and because it is unguessable
-- — the callback endpoint is necessarily public.
--
-- Idempotent: Safaricom retries callbacks, and a retry must not produce a
-- second funding event.

CREATE OR REPLACE FUNCTION public.mark_escrow_funded(
  p_checkout_id TEXT,
  p_receipt TEXT
)
RETURNS public.escrow
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_escrow public.escrow;
BEGIN
  SELECT * INTO v_escrow
  FROM public.escrow
  WHERE mpesa_checkout_id = p_checkout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No escrow matches that checkout id' USING ERRCODE = 'no_data_found';
  END IF;

  -- Already funded: return it unchanged rather than raising, so a retried
  -- callback is answered with success.
  IF v_escrow.status = 'funded' THEN
    RETURN v_escrow;
  END IF;

  IF v_escrow.status <> 'pending' THEN
    RAISE EXCEPTION 'Escrow is % and cannot be funded', v_escrow.status
      USING ERRCODE = 'raise_exception';
  END IF;

  UPDATE public.escrow
     SET status = 'funded',
         mpesa_receipt = p_receipt,
         funded_at = now()
   WHERE id = v_escrow.id
  RETURNING * INTO v_escrow;

  INSERT INTO public.escrow_events (escrow_id, from_status, to_status, actor_id, detail)
  VALUES (v_escrow.id, 'pending', 'funded', NULL, 'M-Pesa receipt ' || coalesce(p_receipt, '(none)'));

  RETURN v_escrow;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. The remaining transitions
-- ---------------------------------------------------------------------------

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

  RETURN v_escrow;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Only the server may call these
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.open_escrow(UUID, UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_escrow_funded(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_escrow(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.open_escrow(UUID, UUID, UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_escrow_funded(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_escrow(UUID, UUID, TEXT, TEXT) TO service_role;

CREATE INDEX IF NOT EXISTS escrow_checkout_id_idx
  ON public.escrow (mpesa_checkout_id)
  WHERE mpesa_checkout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS escrow_parties_idx
  ON public.escrow (employer_id, worker_id, status);
