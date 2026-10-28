BEGIN;

-- Confirmation is Auth-owned, not a user-editable profile/metadata flag.
-- The helper discloses nothing to ordinary users and exposes no Auth table rows.
CREATE FUNCTION public.dtr_admin_can_view_profile(target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.dtr_is_admin() AND EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = target_user_id AND email_confirmed_at IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.dtr_admin_can_view_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dtr_admin_can_view_profile(uuid) TO authenticated;

-- Shared account lists and reports already read profiles under this policy.
-- Keep the independent self-read policy, all write guards and all stored rows.
ALTER POLICY "dtr admin profiles select" ON public.profiles
  USING (public.dtr_admin_can_view_profile(id));

COMMIT;
