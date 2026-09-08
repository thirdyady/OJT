-- Additive profile field for trainee OJT details.
-- Keep this nullable so legacy users with incomplete profiles retain access to
-- their accounts and existing DTR records while they complete their details.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ojt_title TEXT;

COMMENT ON COLUMN public.profiles.ojt_title IS
  'Trainee''s OJT/internship role or title; nullable for legacy profiles.';

-- New registrations pass their required trainee details in auth user metadata.
-- The profile trigger copies those values before email confirmation, while
-- preserving the existing safe behavior for accounts created without them.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, student_id, company, ojt_title)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'student_id'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'company'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'ojt_title'), '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
