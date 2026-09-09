-- Additive target for each trainee's school-specific OJT requirement.
-- Nullable keeps existing accounts usable until a trainee chooses a target.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS required_ojt_hours NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_required_ojt_hours_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_required_ojt_hours_check
      CHECK (required_ojt_hours IS NULL OR (required_ojt_hours > 0 AND required_ojt_hours <= 10000));
  END IF;
END;
$$;

COMMENT ON COLUMN public.profiles.required_ojt_hours IS
  'School-specific OJT hour target chosen by the trainee; nullable until configured.';

-- Admins update only this target through a narrow RPC. No broad admin profile
-- update policy is added, so names, roles, and other profile fields remain
-- protected by the existing RLS model.
CREATE OR REPLACE FUNCTION public.dtr_admin_set_required_ojt_hours(
  target_user_id UUID,
  target_hours NUMERIC
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  updated_profile public.profiles;
BEGIN
  IF NOT public.dtr_is_admin() THEN
    RAISE EXCEPTION 'Only DTR administrators can update trainee targets';
  END IF;

  IF target_hours IS NOT NULL AND (target_hours <= 0 OR target_hours > 10000) THEN
    RAISE EXCEPTION 'Required OJT hours must be greater than 0 and at most 10000';
  END IF;

  UPDATE public.profiles
  SET required_ojt_hours = target_hours
  WHERE id = target_user_id
  RETURNING * INTO updated_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trainee profile was not found';
  END IF;

  RETURN updated_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.dtr_admin_set_required_ojt_hours(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dtr_admin_set_required_ojt_hours(UUID, NUMERIC) TO authenticated;
