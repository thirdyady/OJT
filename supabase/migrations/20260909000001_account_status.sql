-- Account status is additive: deactivation preserves the profile and all DTR
-- rows while preventing the inactive user from using protected operations.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.is_active IS
  'Whether this account may use protected trainee operations; inactive sessions are ended by the app and blocked by RLS.';

-- Keep admin checks from treating an accidentally inactive administrator as
-- privileged. The status-management RPC below also refuses admin targets.
CREATE OR REPLACE FUNCTION public.dtr_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce((
    SELECT is_admin AND is_active
    FROM public.profiles
    WHERE id = auth.uid()
  ), false)
$$;

CREATE OR REPLACE FUNCTION public.dtr_is_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce((
    SELECT is_active
    FROM public.profiles
    WHERE id = auth.uid()
  ), false)
$$;

REVOKE ALL ON FUNCTION public.dtr_is_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dtr_is_active() TO authenticated;

-- Browser callers may keep editing their own profile only while active. The
-- SELECT policy remains available so the app can detect an inactive account.
DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE
USING (auth.uid() = id AND public.dtr_is_active())
WITH CHECK (auth.uid() = id AND public.dtr_is_active());

DROP POLICY IF EXISTS "own dtr all" ON public.dtr_entries;
CREATE POLICY "own dtr all" ON public.dtr_entries FOR ALL
USING (auth.uid() = user_id AND public.dtr_is_active())
WITH CHECK (auth.uid() = user_id AND public.dtr_is_active());

-- Prevent a normal authenticated caller from changing status through REST or
-- upsert. Trusted service-role operations and the admin RPC are allowed.
CREATE OR REPLACE FUNCTION public.protect_dtr_account_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') AND NOT public.dtr_is_admin() THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Account status must be managed by a trusted administrator';
      END IF;
    ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'Account status must be managed by a trusted administrator';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_dtr_account_status ON public.profiles;
CREATE TRIGGER protect_dtr_account_status
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_dtr_account_status();

CREATE OR REPLACE FUNCTION public.dtr_admin_set_account_active(
  target_user_id UUID,
  target_active boolean
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  updated_profile public.profiles;
BEGIN
  IF NOT public.dtr_is_admin() THEN
    RAISE EXCEPTION 'Only DTR administrators can change account status';
  END IF;

  IF target_active IS NULL THEN
    RAISE EXCEPTION 'Account status must be active or inactive';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = target_user_id AND is_admin
  ) THEN
    RAISE EXCEPTION 'Administrator account status cannot be changed here';
  END IF;

  UPDATE public.profiles
  SET is_active = target_active
  WHERE id = target_user_id
  RETURNING * INTO updated_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account profile was not found';
  END IF;

  RETURN updated_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.dtr_admin_set_account_active(UUID, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dtr_admin_set_account_active(UUID, boolean) TO authenticated;
