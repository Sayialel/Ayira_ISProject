-- Provisioning and privilege protection for public.users.
--
-- Two problems this solves:
--
-- 1. The web app signs users up with supabase.auth.signUp(), which only creates
--    an auth.users row. Without a matching public.users row every foreign key
--    (gigs.employer_id, applications.worker_id, ...) fails. A trigger covers
--    every signup path rather than relying on each client to remember.
--
-- 2. Migration 001 lets a user UPDATE their own row, which includes `role`,
--    `is_verified` and `reputation_score`. Since the anon key is public, a user
--    could promote themselves straight from the browser. Postgres policies
--    cannot restrict individual columns, so a trigger pins those values instead.

-- ---------------------------------------------------------------------------
-- 1. Create the profile row whenever an auth user is created
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      split_part(COALESCE(NEW.email, 'member'), '@', 1)
    ),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    -- Anything other than the two self-service roles falls back to 'worker',
    -- so a crafted metadata payload cannot mint an admin and cannot break the
    -- CHECK constraint either.
    CASE
      WHEN NEW.raw_user_meta_data->>'role' IN ('worker', 'employer')
        THEN NEW.raw_user_meta_data->>'role'
      ELSE 'worker'
    END
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. Stop users from editing their own privileged columns
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_user_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The service role (API gateway, admin routes, triggers) is trusted; every
  -- other caller keeps whatever these columns already held.
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.role := OLD.role;
  NEW.is_verified := OLD.is_verified;
  NEW.reputation_score := OLD.reputation_score;
  NEW.email := OLD.email;
  NEW.id := OLD.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_user_privileges ON public.users;

CREATE TRIGGER protect_user_privileges
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_user_privileges();

-- ---------------------------------------------------------------------------
-- 3. Backfill profiles for any auth users created before this migration
-- ---------------------------------------------------------------------------

INSERT INTO public.users (id, email, full_name, phone, role)
SELECT
  au.id,
  au.email,
  COALESCE(
    NULLIF(au.raw_user_meta_data->>'full_name', ''),
    split_part(COALESCE(au.email, 'member'), '@', 1)
  ),
  NULLIF(au.raw_user_meta_data->>'phone', ''),
  CASE
    WHEN au.raw_user_meta_data->>'role' IN ('worker', 'employer')
      THEN au.raw_user_meta_data->>'role'
    ELSE 'worker'
  END
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL
  AND au.email IS NOT NULL;
