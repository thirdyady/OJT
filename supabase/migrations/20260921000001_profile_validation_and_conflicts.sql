BEGIN;

-- Reject incomplete NEW public registrations without changing legacy profiles.
-- Trusted provisioning also supplies these fields for new accounts.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE whitespace CONSTANT TEXT := E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF (
    nullif(btrim(NEW.raw_user_meta_data->>'full_name', whitespace), '') IS NULL OR
    nullif(btrim(NEW.raw_user_meta_data->>'student_id', whitespace), '') IS NULL OR
    nullif(btrim(NEW.raw_user_meta_data->>'company', whitespace), '') IS NULL OR
    nullif(btrim(NEW.raw_user_meta_data->>'ojt_title', whitespace), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Complete all required trainee details';
  END IF;
  INSERT INTO public.profiles (id, full_name, student_id, company, ojt_title)
  VALUES (NEW.id,
    coalesce(nullif(btrim(NEW.raw_user_meta_data->>'full_name', whitespace), ''), NEW.raw_user_meta_data->>'name', ''),
    nullif(btrim(NEW.raw_user_meta_data->>'student_id', whitespace), ''),
    nullif(btrim(NEW.raw_user_meta_data->>'company', whitespace), ''),
    nullif(btrim(NEW.raw_user_meta_data->>'ojt_title', whitespace), ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Replace the old signature so old/stale clients cannot bypass the version.
DROP FUNCTION IF EXISTS public.dtr_admin_update_trainee_profile(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC);
CREATE OR REPLACE FUNCTION public.dtr_admin_update_trainee_profile(
  target_user_id UUID, new_full_name TEXT, new_student_id TEXT,
  new_company TEXT, new_ojt_title TEXT, new_required_ojt_hours NUMERIC,
  expected_updated_at TIMESTAMPTZ
)
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  updated_profile public.profiles;
  whitespace CONSTANT TEXT := E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF NOT public.dtr_is_admin() THEN
    RAISE EXCEPTION 'Only DTR administrators can update trainee profiles';
  END IF;
  IF nullif(btrim(new_full_name, whitespace), '') IS NULL
    OR nullif(btrim(new_student_id, whitespace), '') IS NULL
    OR nullif(btrim(new_company, whitespace), '') IS NULL
    OR nullif(btrim(new_ojt_title, whitespace), '') IS NULL THEN
    RAISE EXCEPTION 'Complete all required trainee details';
  END IF;
  UPDATE public.profiles SET full_name = btrim(new_full_name, whitespace), student_id = btrim(new_student_id, whitespace),
    company = btrim(new_company, whitespace), ojt_title = btrim(new_ojt_title, whitespace), required_ojt_hours = new_required_ojt_hours
  WHERE id = target_user_id AND updated_at = expected_updated_at RETURNING * INTO updated_profile;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This profile changed. Reload records before saving again' USING ERRCODE = '40001';
  END IF;
  RETURN updated_profile;
END;
$$;
REVOKE ALL ON FUNCTION public.dtr_admin_update_trainee_profile(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dtr_admin_update_trainee_profile(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ) TO authenticated;

COMMIT;
