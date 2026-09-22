BEGIN;

CREATE TYPE public.account_type AS ENUM ('ojt', 'job_order', 'processing', 'regular_employee');

-- A constant default backfills without rewriting profile values or firing the
-- updated_at trigger. Administrator privileges remain independent of category.
ALTER TABLE public.profiles
  ADD COLUMN account_type public.account_type NOT NULL DEFAULT 'ojt',
  ADD COLUMN required_workdays INTEGER,
  ADD CONSTRAINT profiles_account_type_targets_check CHECK (
    (account_type = 'ojt' AND required_workdays IS NULL)
    OR (account_type = 'processing'
        AND required_ojt_hours IS NULL
        AND required_workdays IS NOT NULL AND required_workdays > 0)
    OR (account_type IN ('job_order', 'regular_employee')
        AND required_ojt_hours IS NULL AND required_workdays IS NULL)
  );

COMMENT ON COLUMN public.profiles.account_type IS
  'Employment category, independent of is_admin and the existing ojt_title job/title field. Legacy profiles retain OJT behavior.';
COMMENT ON COLUMN public.profiles.required_workdays IS
  'Required completed days for Processing only; Job Order and Regular Employee have no progress target. Managed by trusted server operations.';

-- RLS already limits profile ownership. A column guard is additionally needed:
-- an own-row UPDATE policy must not allow forged employment classifications.
-- Check the JWT role, not current_user: old SECURITY DEFINER RPCs must not
-- accidentally bypass this protection when called by an authenticated browser.
CREATE FUNCTION public.protect_dtr_employment_fields()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.account_type IS DISTINCT FROM 'ojt'::public.account_type
        OR NEW.required_workdays IS NOT NULL THEN
        RAISE EXCEPTION 'Employment fields require authorized server-side access' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NEW.account_type IS DISTINCT FROM OLD.account_type
        OR NEW.required_workdays IS DISTINCT FROM OLD.required_workdays THEN
        RAISE EXCEPTION 'Employment fields require authorized server-side access' USING ERRCODE = '42501';
      END IF;
      -- Preserve legacy OJT self-service, but do not expose employee placement
      -- edits through the old trainee form or its SECURITY DEFINER RPC.
      IF OLD.account_type <> 'ojt' AND (
        NEW.company IS DISTINCT FROM OLD.company
        OR NEW.ojt_title IS DISTINCT FROM OLD.ojt_title
        OR NEW.student_id IS DISTINCT FROM OLD.student_id
        OR NEW.required_ojt_hours IS DISTINCT FROM OLD.required_ojt_hours
      ) THEN
        RAISE EXCEPTION 'Employment fields require authorized server-side access' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_dtr_employment_fields() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_dtr_employment_fields BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_dtr_employment_fields();

-- Existing role/status guards, signup defaults and attendance RESTRICT FK stay
-- in force. Never derive category or privileges from user-editable metadata.
COMMIT;
