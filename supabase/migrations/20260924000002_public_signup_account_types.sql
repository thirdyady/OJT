BEGIN;

-- Public signup may select an employment category only at creation.
-- Trusted administrator provisioning takes precedence. Existing profiles and
-- update guards are unchanged; category never grants administrator privileges.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  whitespace CONSTANT TEXT := E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  saved_user auth.users;
  category public.account_type;
  person_name TEXT;
  student TEXT;
  employer TEXT;
  title TEXT;
  targets JSONB;
BEGIN
  -- Auth's admin API inserts the user before updating app_metadata in the same
  -- transaction. Read the final row from a deferred trigger, never the initial
  -- NEW snapshot. Both Auth and the correctly classified profile commit together.
  SELECT * INTO saved_user FROM auth.users WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF saved_user.raw_app_meta_data ? 'dtr_account_type' THEN
    category := (saved_user.raw_app_meta_data->>'dtr_account_type')::public.account_type;
    targets := jsonb_build_object(
      'hours', saved_user.raw_app_meta_data->'dtr_required_ojt_hours',
      'days', saved_user.raw_app_meta_data->'dtr_required_workdays');
  ELSE
    category := coalesce(saved_user.raw_user_meta_data->>'account_type', 'ojt')::public.account_type;
    targets := jsonb_build_object(
      'hours', saved_user.raw_user_meta_data->'required_ojt_hours',
      'days', saved_user.raw_user_meta_data->'required_workdays');
  END IF;
  -- Avoid numeric-to-integer rounding accepting fractional day targets.
  IF targets->>'days' IS NOT NULL AND (targets->>'days') !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'Required workdays must be a positive whole number';
  END IF;
  person_name := nullif(btrim(saved_user.raw_user_meta_data->>'full_name', whitespace), '');
  student := nullif(btrim(saved_user.raw_user_meta_data->>'student_id', whitespace), '');
  employer := nullif(btrim(saved_user.raw_user_meta_data->>'company', whitespace), '');
  title := nullif(btrim(saved_user.raw_user_meta_data->>'ojt_title', whitespace), '');
  IF person_name IS NULL OR employer IS NULL OR title IS NULL
    OR (category = 'ojt' AND student IS NULL) THEN
    RAISE EXCEPTION 'Complete all required account details';
  END IF;
  INSERT INTO public.profiles (
    id, full_name, student_id, company, ojt_title, account_type,
    required_ojt_hours, required_workdays, is_admin, is_active
  ) VALUES (
    NEW.id, person_name, CASE WHEN category = 'ojt' THEN student ELSE NULL END,
    employer, title, category,
    (targets->>'hours')::numeric,
    (targets->>'days')::integer,
    false, true
  );
  -- M12 constraints reject incompatible/missing targets atomically with Auth
  -- creation. A duplicate profile must not silently hide a provisioning error.
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

COMMIT;
