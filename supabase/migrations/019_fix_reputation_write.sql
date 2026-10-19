-- Let the review trigger actually write a reputation score.
--
-- Two correct-looking pieces that cancelled each other out:
--
--   * migration 010 added update_reputation(), an AFTER INSERT trigger on
--     reviews that recomputes users.reputation_score as AVG(reviews.rating);
--   * migration 011 added protect_user_privileges(), a BEFORE UPDATE trigger on
--     users that reverts privileged columns -- including reputation_score --
--     for any caller that is not the service role.
--
-- update_reputation() is not SECURITY DEFINER, so it runs as whoever inserted
-- the review. A worker posting a review is `authenticated`, so the guard
-- reverted the very column the trigger had just computed.
--
-- The effect was silent and total: inserting a review succeeded, the trigger
-- ran, and reputation_score stayed at 0.00 forever. Verified against the live
-- database before writing this -- a 5-star review left the employer on 0.00.
--
-- It matters more since migration 017, because the matching engine now scores
-- the *employer's* reputation. A column that can never move is a ranking
-- signal pinned to its neutral prior, which is the defect 017 set out to fix.
--
-- The fix keeps the protection and opens one narrow, server-controlled door:
-- update_reputation() raises a transaction-local flag that the guard honours.
-- Nothing else can set it, because update_reputation() is the only function
-- that does and it only ever recomputes from the reviews table. A user
-- updating their own row directly still cannot touch reputation_score.

-- ---------------------------------------------------------------------------
-- 1. The guard, with one exception
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_user_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The service role (API gateway, admin routes) is trusted outright.
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.role := OLD.role;
  NEW.is_verified := OLD.is_verified;
  NEW.email := OLD.email;
  NEW.id := OLD.id;

  -- reputation_score is normally reverted too, so a worker cannot award
  -- themselves five stars. The single exception is update_reputation(), which
  -- recomputes the average from the reviews table and raises this flag for the
  -- duration of its own statement. The flag is transaction-local and set
  -- nowhere else.
  IF coalesce(current_setting('ayira.recomputing_reputation', true), '') <> 'on' THEN
    NEW.reputation_score := OLD.reputation_score;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The trigger that uses it
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_reputation()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY DEFINER so it may update another user's row: a worker reviewing an
-- employer has no rights over that employer's record, and should not need any.
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- true = transaction-local, so it cannot leak into later statements or
  -- other sessions.
  PERFORM set_config('ayira.recomputing_reputation', 'on', true);

  UPDATE public.users
     SET reputation_score = (
           SELECT round(avg(rating)::numeric, 2)
           FROM public.reviews
           WHERE reviewee_id = NEW.reviewee_id
         )
   WHERE id = NEW.reviewee_id;

  PERFORM set_config('ayira.recomputing_reputation', 'off', true);

  RETURN NEW;
END;
$$;

-- The average changes when a review is edited or removed, not only when one is
-- added, and reputation that only ever moves one way is not a reputation.
DROP TRIGGER IF EXISTS on_review_insert ON public.reviews;
CREATE TRIGGER on_review_insert
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_reputation();

DROP TRIGGER IF EXISTS on_review_update ON public.reviews;
CREATE TRIGGER on_review_update
  AFTER UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_reputation();

-- ---------------------------------------------------------------------------
-- 3. A deletion has to recompute from the row that is going away
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_reputation_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('ayira.recomputing_reputation', 'on', true);

  UPDATE public.users
     SET reputation_score = coalesce(
           (SELECT round(avg(rating)::numeric, 2)
              FROM public.reviews
             WHERE reviewee_id = OLD.reviewee_id),
           0
         )
   WHERE id = OLD.reviewee_id;

  PERFORM set_config('ayira.recomputing_reputation', 'off', true);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_review_delete ON public.reviews;
CREATE TRIGGER on_review_delete
  AFTER DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_reputation_on_delete();

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------
--
-- Reviews written before this fix left reputation at 0.00, so recompute every
-- reviewed user once. Runs as the migration owner with the flag raised.

DO $$
BEGIN
  PERFORM set_config('ayira.recomputing_reputation', 'on', true);

  UPDATE public.users u
     SET reputation_score = agg.average
    FROM (
      SELECT reviewee_id, round(avg(rating)::numeric, 2) AS average
      FROM public.reviews
      GROUP BY reviewee_id
    ) agg
   WHERE u.id = agg.reviewee_id
     AND u.reputation_score IS DISTINCT FROM agg.average;

  PERFORM set_config('ayira.recomputing_reputation', 'off', true);
END;
$$;
