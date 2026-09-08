-- Additive: existing accounts and attendance remain intact.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- SECURITY DEFINER avoids recursive profiles RLS evaluation. Only the caller's
-- own role is returned; roles cannot be supplied by the browser.
CREATE OR REPLACE FUNCTION public.dtr_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT coalesce((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false) $$;
REVOKE ALL ON FUNCTION public.dtr_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dtr_is_admin() TO authenticated;

-- Existing profile policies allow self-service edits: protect role assignment
-- even when a caller sends is_admin directly through the REST API.
CREATE OR REPLACE FUNCTION public.protect_dtr_admin_role()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_admin THEN RAISE EXCEPTION 'Admin roles must be assigned by a trusted administrator'; END IF;
    ELSIF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Admin roles must be assigned by a trusted administrator';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_dtr_admin_role BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_dtr_admin_role();

CREATE POLICY "dtr admin profiles select" ON public.profiles FOR SELECT TO authenticated
USING (public.dtr_is_admin());
CREATE POLICY "dtr admin entries select" ON public.dtr_entries FOR SELECT TO authenticated
USING (public.dtr_is_admin());
CREATE POLICY "dtr admin entries update" ON public.dtr_entries FOR UPDATE TO authenticated
USING (public.dtr_is_admin()) WITH CHECK (public.dtr_is_admin());
CREATE POLICY "dtr admin entries delete" ON public.dtr_entries FOR DELETE TO authenticated
USING (public.dtr_is_admin());
