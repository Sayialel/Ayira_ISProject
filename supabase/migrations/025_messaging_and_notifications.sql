-- Prepares the messages and notifications tables for actual use.
--
-- Migrations 006 and 007 created both tables in the first week of the project
-- and no code has touched them since: no gateway route, no frontend. Before
-- wiring them up, three things in them were worth settling.
--
-- Note on what is NOT here. The obvious hole -- "Users can send messages"
-- checking only `auth.uid() = sender_id`, leaving every account one INSERT
-- away from an open inbox -- was already closed by migration 013 (L-02),
-- which scoped messaging to two parties connected by a gig. That policy is
-- kept as it stands. This migration only narrows the case it deliberately
-- left open.
--
-- 1. A RECIPIENT COULD REWRITE WHAT THEY WERE SENT.
--    Both tables had an UPDATE policy with a USING clause and no WITH CHECK,
--    and Postgres RLS cannot see the OLD row in WITH CHECK, so "only is_read
--    may change" is not expressible as a policy at all. A receiver could have
--    edited `content` -- or `sender_id` -- on a message already delivered,
--    which would make a thread worthless as evidence in an escrow dispute.
--    Marking read now goes through SECURITY DEFINER functions that touch that
--    one column, and direct UPDATE is revoked, following the pattern migration
--    012 established for accept_application.
--
-- 2. messages.gig_id WAS NULLABLE, AND 013 TOLERATED THAT.
--    Its policy ends `AND (messages.gig_id IS NULL OR g.id = messages.gig_id)`,
--    so a message with no gig was authorised by the existence of *any* shared
--    gig between the two parties and then belonged to none of them. Every
--    access rule here is derived from the gig, so a thread attached to no gig
--    has no rule that can apply to it later. Making the column NOT NULL makes
--    that branch unreachable and leaves 013's policy strictly tighter than it
--    was written.
--
-- 3. DELETING A GIG WOULD HAVE FAILED ON THE FOREIGN KEY.
--    gig_id referenced gigs(id) with no delete rule, so once threads existed,
--    removing a gig would error instead of clearing them.
--
-- Also adds the indexes both tables need. Every query the feature issues is
-- "a thread, in order" or "my unread count", and neither had an index for it.
--
-- Both tables are empty -- verified against the live database before writing
-- this -- so the constraints below are tightened rather than migrated.

-- ---------------------------------------------------------------------------
-- 1. messages: keys, constraints, indexes
-- ---------------------------------------------------------------------------

ALTER TABLE public.messages
  ALTER COLUMN gig_id SET NOT NULL;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_gig_id_fkey;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_gig_id_fkey
  FOREIGN KEY (gig_id) REFERENCES public.gigs(id) ON DELETE CASCADE;

-- An empty or whitespace-only message is not a message.
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_content_not_blank;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_content_not_blank
  CHECK (length(btrim(content)) > 0);

-- 013's policy already refuses a self-send. Stated again as a table
-- constraint so it holds for the service role too, which bypasses RLS.
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_no_self_send;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_no_self_send
  CHECK (sender_id <> receiver_id);

-- Replaced by mark_thread_read below. See note 1.
DROP POLICY IF EXISTS "Receivers can mark as read" ON public.messages;

-- Reading a thread in order is the only read this table serves.
CREATE INDEX IF NOT EXISTS messages_gig_created_idx
  ON public.messages (gig_id, created_at);

-- The unread badge, per recipient. Partial, because read messages are the
-- majority over time and never match this query.
CREATE INDEX IF NOT EXISTS messages_unread_idx
  ON public.messages (receiver_id)
  WHERE is_read = FALSE;

-- Listing one person's threads, newest first.
CREATE INDEX IF NOT EXISTS messages_participants_idx
  ON public.messages (sender_id, receiver_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. notifications: indexes, and no direct writes
-- ---------------------------------------------------------------------------

-- Replaced by mark_notifications_read below. See note 1.
DROP POLICY IF EXISTS "Users can mark own as read" ON public.notifications;

-- There is deliberately no INSERT policy. A notification is a claim about
-- something the server observed, so it is written with the service role; a
-- client that could insert its own could fabricate "you have been paid".

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON public.notifications (user_id)
  WHERE is_read = FALSE;

-- ---------------------------------------------------------------------------
-- 3. Marking read, as functions rather than policies
-- ---------------------------------------------------------------------------

-- Takes the reader as an argument rather than reading auth.uid(), because the
-- gateway calls this with the service role and has already resolved who the
-- caller is from their token -- the same reason accept_application does.
--
-- p_other_id is not redundant. A thread is (gig, counterparty), not (gig):
-- an employer with three applicants on one gig has three threads on it, and
-- keying on the gig alone would mark all three read when they opened one.
CREATE OR REPLACE FUNCTION public.mark_thread_read(
  p_gig_id UUID,
  p_user_id UUID,
  p_other_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE public.messages
     SET is_read = TRUE
   WHERE gig_id = p_gig_id
     AND receiver_id = p_user_id
     AND sender_id = p_other_id
     AND is_read = FALSE;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_thread_read(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_thread_read(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.mark_thread_read(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_thread_read(UUID, UUID, UUID) TO service_role;

-- p_ids NULL means "everything unread for this user"; a list marks just those.
CREATE OR REPLACE FUNCTION public.mark_notifications_read(
  p_user_id UUID,
  p_ids UUID[] DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE public.notifications
     SET is_read = TRUE
   WHERE user_id = p_user_id
     AND is_read = FALSE
     AND (p_ids IS NULL OR id = ANY(p_ids));

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_notifications_read(UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.mark_notifications_read(UUID, UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(UUID, UUID[]) TO service_role;

-- No UPDATE for a signed-in client on either table. Everything they are
-- allowed to change goes through the two functions above.
REVOKE UPDATE ON public.messages FROM authenticated;
REVOKE UPDATE ON public.notifications FROM authenticated;
