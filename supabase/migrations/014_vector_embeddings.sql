-- H-04 from the engineering review: stop re-encoding the whole catalogue on
-- every match request.
--
-- Gig text changes when an employer edits a gig, which is rare. Worker text
-- changes when a profile is edited, which is rarer. Neither needs recomputing
-- per request, but the engine did exactly that — so matching cost grew with
-- catalogue size multiplied by traffic, the worst combination available.
--
-- Embeddings move into Postgres, computed once and reused until the text they
-- describe actually changes.

CREATE EXTENSION IF NOT EXISTS vector;

-- 384 dimensions is the output size of all-MiniLM-L6-v2. Changing the model
-- means changing this number and rebuilding every stored vector, which is why
-- the hash column below records what was embedded rather than only when.
ALTER TABLE public.gigs
  ADD COLUMN IF NOT EXISTS embedding vector(384),
  ADD COLUMN IF NOT EXISTS embedding_hash TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS embedding vector(384),
  ADD COLUMN IF NOT EXISTS embedding_hash TEXT;

COMMENT ON COLUMN public.gigs.embedding_hash IS
  'Hash of the exact text that produced the embedding. A mismatch means the gig was edited and the vector is stale.';

COMMENT ON COLUMN public.users.embedding_hash IS
  'Hash of the exact profile text that produced the embedding. A mismatch means skills or bio changed.';

-- HNSW gives approximate nearest-neighbour search that stays sub-linear as the
-- catalogue grows. Cosine distance matches how the model's vectors are
-- compared — they are normalised, so cosine and inner product agree, but
-- naming cosine keeps the intent obvious.
--
-- The index is built on an effectively empty table here, which is the cheap
-- moment to do it.
CREATE INDEX IF NOT EXISTS gigs_embedding_idx
  ON public.gigs USING hnsw (embedding vector_cosine_ops);

-- Finding gigs that still need embedding is a hot path for the backfill, and
-- this keeps it from scanning the whole table.
CREATE INDEX IF NOT EXISTS gigs_embedding_missing_idx
  ON public.gigs (status)
  WHERE embedding IS NULL;
