-- H-06, L-01 and L-02 from the engineering review.

-- ---------------------------------------------------------------------------
-- H-06 — make gig search use an index
-- ---------------------------------------------------------------------------
--
-- Search ran as ILIKE '%term%' over title and description. A leading wildcard
-- makes a B-tree index unusable, so every search was a sequential scan of the
-- whole table.
--
-- A GIN index over a tsvector gives real full-text search: stemming ("designer"
-- matches "design"), relevance ranking, and index-backed lookup. The column is
-- generated, so Postgres keeps it in step with title and description without
-- any application code.

ALTER TABLE public.gigs
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    -- Title matters more than body text, so it is weighted above description.
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS gigs_search_vector_idx
  ON public.gigs USING GIN (search_vector);

-- Supporting indexes for the filters the feed applies on every request.
CREATE INDEX IF NOT EXISTS gigs_status_created_at_idx
  ON public.gigs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS gigs_employer_id_idx
  ON public.gigs (employer_id);

CREATE INDEX IF NOT EXISTS gigs_category_idx
  ON public.gigs (category);

-- Applications are looked up by gig (the employer's applicant list) and by
-- worker (the worker's own list) constantly.
CREATE INDEX IF NOT EXISTS applications_gig_id_idx
  ON public.applications (gig_id);

CREATE INDEX IF NOT EXISTS applications_worker_id_idx
  ON public.applications (worker_id);

-- ---------------------------------------------------------------------------
-- L-01 — make the escrow delete behaviour a decision, not an accident
-- ---------------------------------------------------------------------------
--
-- These foreign keys had no ON DELETE clause, so they defaulted to NO ACTION
-- and blocked deleting any user with escrow history. That is the right
-- behaviour for financial records — it should just be stated explicitly rather
-- than inherited, and RESTRICT fails immediately rather than at commit.

ALTER TABLE public.escrow
  DROP CONSTRAINT IF EXISTS escrow_employer_id_fkey,
  ADD CONSTRAINT escrow_employer_id_fkey
    FOREIGN KEY (employer_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE public.escrow
  DROP CONSTRAINT IF EXISTS escrow_worker_id_fkey,
  ADD CONSTRAINT escrow_worker_id_fkey
    FOREIGN KEY (worker_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE public.escrow
  DROP CONSTRAINT IF EXISTS escrow_gig_id_fkey,
  ADD CONSTRAINT escrow_gig_id_fkey
    FOREIGN KEY (gig_id) REFERENCES public.gigs(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- L-02 — messages require a shared gig
-- ---------------------------------------------------------------------------
--
-- The old policy checked only that the sender was the caller, so the messaging
-- feature would ship as an open channel from any user to any user. Settling
-- this before Phase 6 is built is far cheaper than retrofitting it after.
--
-- A message is allowed when the two parties are connected by a gig: one is the
-- employer and the other applied to it.

DROP POLICY IF EXISTS "Users can send messages" ON public.messages;

CREATE POLICY "Participants of a shared gig can message"
  ON public.messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND sender_id <> receiver_id
    AND EXISTS (
      SELECT 1
      FROM public.gigs g
      JOIN public.applications a ON a.gig_id = g.id
      WHERE (
              (g.employer_id = messages.sender_id AND a.worker_id = messages.receiver_id)
           OR (g.employer_id = messages.receiver_id AND a.worker_id = messages.sender_id)
            )
        -- When the message is scoped to a gig, it must be that same gig.
        AND (messages.gig_id IS NULL OR g.id = messages.gig_id)
    )
  );
