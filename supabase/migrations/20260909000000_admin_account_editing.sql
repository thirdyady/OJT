-- Admin account-management foundation. Keep profile writes narrow so callers
-- cannot change ids, ownership, or the protected is_admin flag.
CREATE OR REPLACE FUNCTION public.dtr_admin_update_trainee_profile(
  target_user_id UUID,
  new_full_name TEXT,
  new_student_id TEXT,
  new_company TEXT,
  new_ojt_title TEXT,
  new_required_ojt_hours NUMERIC
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  updated_profile public.profiles;
BEGIN
  IF NOT public.dtr_is_admin() THEN
    RAISE EXCEPTION 'Only DTR administrators can update trainee profiles';
  END IF;

  IF new_required_ojt_hours IS NOT NULL
     AND (new_required_ojt_hours <= 0 OR new_required_ojt_hours > 10000) THEN
    RAISE EXCEPTION 'Required OJT hours must be greater than 0 and at most 10000';
  END IF;

  UPDATE public.profiles
  SET full_name = NULLIF(trim(new_full_name), ''),
      student_id = NULLIF(trim(new_student_id), ''),
      company = NULLIF(trim(new_company), ''),
      ojt_title = NULLIF(trim(new_ojt_title), ''),
      required_ojt_hours = new_required_ojt_hours
  WHERE id = target_user_id
  RETURNING * INTO updated_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trainee profile was not found';
  END IF;

  RETURN updated_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.dtr_admin_update_trainee_profile(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dtr_admin_update_trainee_profile(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;
