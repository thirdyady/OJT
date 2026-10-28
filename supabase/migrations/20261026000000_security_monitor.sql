BEGIN;
-- Separate access role: never create an employee profile for a monitor.
CREATE TABLE dtr_private.security_monitors (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true
);
REVOKE ALL ON dtr_private.security_monitors FROM PUBLIC, anon, authenticated, service_role;
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
  IF saved_user.raw_app_meta_data->>'dtr_access_role' = 'security_monitor' THEN
    INSERT INTO dtr_private.security_monitors(user_id) VALUES (NEW.id);
    RETURN NEW;
  END IF;
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


CREATE FUNCTION public.dtr_is_security_monitor() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM dtr_private.security_monitors WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.dtr_is_security_monitor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dtr_is_security_monitor() TO authenticated;

-- Block self-profile insertion and accidental privileged conversion as well.
CREATE FUNCTION public.dtr_guard_monitor_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM dtr_private.security_monitors WHERE user_id = NEW.id) THEN
    RAISE EXCEPTION 'Monitor accounts cannot have employee profiles' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.dtr_guard_monitor_profile() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_monitor_profile BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.dtr_guard_monitor_profile();

CREATE FUNCTION public.dtr_security_logs(log_date date, after_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, full_name text, account_type public.account_type,
 check_in timestamptz, break_out timestamptz, break_in timestamptz, check_out timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM dtr_private.security_monitors WHERE user_id=auth.uid() AND is_active
  ) THEN RAISE EXCEPTION 'Security monitor access is unavailable' USING ERRCODE='42501'; END IF;
  IF log_date IS NULL OR log_date > (now() AT TIME ZONE 'Asia/Manila')::date THEN
    RAISE EXCEPTION 'Choose today or a previous date';
  END IF;
  RETURN QUERY SELECT d.id, p.full_name, p.account_type, d.check_in, d.break_out, d.break_in, d.check_out
    FROM public.dtr_entries d JOIN public.profiles p ON p.id=d.user_id
    WHERE d.entry_date=log_date AND NOT p.is_admin AND (after_id IS NULL OR d.id>after_id)
    ORDER BY d.id LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.dtr_security_logs(date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dtr_security_logs(date,uuid) TO authenticated;
COMMIT;
