BEGIN;

-- Public signup remains OJT. Only trusted Auth admin APIs can supply
-- raw_app_meta_data; user-editable metadata never selects employment or role.
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
BEGIN
  -- Auth's admin API inserts the user before updating app_metadata in the same
  -- transaction. Read the final row from a deferred trigger, never the initial
  -- NEW snapshot. Both Auth and the correctly classified profile commit together.
  SELECT * INTO saved_user FROM auth.users WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  category := coalesce(saved_user.raw_app_meta_data->>'dtr_account_type', 'ojt')::public.account_type;
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
    (saved_user.raw_app_meta_data->>'dtr_required_ojt_hours')::numeric,
    (saved_user.raw_app_meta_data->>'dtr_required_workdays')::integer,
    false, true
  );
  -- M12 constraints reject incompatible/missing targets atomically with Auth
  -- creation. A duplicate profile must not silently hide a provisioning error.
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER on_auth_user_created ON auth.users;
CREATE CONSTRAINT TRIGGER on_auth_user_created AFTER INSERT ON auth.users
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMIT;
