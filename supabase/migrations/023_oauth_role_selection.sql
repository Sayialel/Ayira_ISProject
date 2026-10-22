-- Make room for sign-in methods that cannot ask which role you are.
--
-- handle_new_user reads the role out of raw_user_meta_data, which works for
-- email signup because the form collects it. An OAuth provider supplies name,
-- email and a picture, and nothing else -- Google has no idea this platform
-- has workers and employers. So the CASE falls through to 'worker'.
--
-- That is silent and unrecoverable. An employer who signs in with Google
-- becomes a worker, sees the worker navigation, and cannot fix it: migration
-- 011's protect_user_privileges reverts any role change that does not come
-- from the service role. They would have to ask an administrator to repair an
-- account they only just created.
--
-- The fix is to record whether the role was actually chosen, rather than
-- inferring it from the value. 'worker' set deliberately and 'worker' arrived
-- at by default are indistinguishable in the column itself, which is why a
-- separate flag is needed rather than a cleverer default.

-- ---------------------------------------------------------------------------
-- 1. Did this person choose their role?
-- ---------------------------------------------------------------------------

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.users.role_confirmed IS
  'True when the role was chosen by the person rather than defaulted. False '
  'after an OAuth signup, which is what the onboarding step looks for.';

-- Everyone who exists now either chose at signup, was seeded, or is staff.
-- None of them should be asked again.
UPDATE public.users SET role_confirmed = TRUE WHERE role_confirmed IS FALSE;

-- ---------------------------------------------------------------------------
-- 2. Provisioning, now aware of both routes in
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_chose BOOLEAN;
BEGIN
  -- Anything other than the two self-service roles falls back to 'worker', so
  -- a crafted metadata payload cannot mint an admin and cannot break the CHECK
  -- constraint either.
  -- COALESCE is load-bearing. An OAuth signup carries no 'role' key at all,
  -- and `NULL IN (...)` is NULL rather than false in SQL, so without it the
  -- NOT NULL column below rejects the row and the whole signup fails with a
  -- 500 -- which is exactly how this was found.
  v_chose := COALESCE(NEW.raw_user_meta_data->>'role' IN ('worker', 'employer'), FALSE);
  v_role := CASE WHEN v_chose THEN NEW.raw_user_meta_data->>'role' ELSE 'worker' END;

  INSERT INTO public.users (id, email, full_name, phone, role, role_confirmed, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      -- Google sends 'name'; other providers vary. Falling back to the local
      -- part of the address beats showing someone a blank where their name
      -- should be.
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      split_part(COALESCE(NEW.email, 'member'), '@', 1)
    ),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    v_role,
    v_chose,
    -- Google calls it 'picture', Supabase normalises some providers to
    -- 'avatar_url'. Taking either saves asking for a photo they have already
    -- given us.
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'avatar_url', ''),
      NULLIF(NEW.raw_user_meta_data->>'picture', '')
    )
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Choosing a role, exactly once
-- ---------------------------------------------------------------------------
--
-- Not a plain UPDATE from the client: protect_user_privileges reverts role for
-- anyone but the service role, and lifting that to let people set their own
-- role would also let them set it again later, or set it to admin.
--
-- This runs as the owner, accepts only the two self-service roles, and refuses
-- once the choice is recorded. So the window is exactly one decision, taken by
-- the account holder, and it closes behind them.

CREATE OR REPLACE FUNCTION public.confirm_user_role(
  p_user_id UUID,
  p_role TEXT
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users;
BEGIN
  IF p_role NOT IN ('worker', 'employer') THEN
    RAISE EXCEPTION 'Role must be worker or employer' USING ERRCODE = 'raise_exception';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_user.role_confirmed THEN
    RAISE EXCEPTION 'This account already has a role and it cannot be changed here'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The guard trigger reverts role for non-service-role callers, and this
  -- function may be reached through one. Raising the same transaction-local
  -- flag migration 019 uses for reputation keeps the guard intact while
  -- letting this one deliberate write through.
  PERFORM set_config('ayira.recomputing_reputation', 'on', true);

  UPDATE public.users
     SET role = p_role,
         role_confirmed = TRUE
   WHERE id = p_user_id
  RETURNING * INTO v_user;

  PERFORM set_config('ayira.recomputing_reputation', 'off', true);

  RETURN v_user;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_user_role(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_user_role(UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. role_confirmed is not the account holder's to set
-- ---------------------------------------------------------------------------
--
-- Without this a user could set the flag themselves and shut the onboarding
-- window before choosing, stranding themselves as a worker -- the very outcome
-- this migration exists to prevent.

CREATE OR REPLACE FUNCTION public.protect_user_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.is_verified := OLD.is_verified;
  NEW.email := OLD.email;
  NEW.id := OLD.id;

  -- role and role_confirmed move together, and only through the flagged path
  -- that confirm_user_role and update_reputation use.
  IF coalesce(current_setting('ayira.recomputing_reputation', true), '') <> 'on' THEN
    NEW.role := OLD.role;
    NEW.role_confirmed := OLD.role_confirmed;
    NEW.reputation_score := OLD.reputation_score;
  END IF;

  RETURN NEW;
END;
$$;
