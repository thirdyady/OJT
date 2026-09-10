BEGIN;

-- Preserve every existing row. PostgreSQL's FK locks serialize a concurrent
-- attendance insert against account deletion; a preflight count alone cannot.
ALTER TABLE public.dtr_entries
  DROP CONSTRAINT dtr_entries_user_id_fkey,
  ADD CONSTRAINT dtr_entries_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

-- Only the trusted server may supply actor_user_id, taken from verified Auth
-- middleware, never from browser input. All checks and deletion are atomic.
CREATE FUNCTION public.dtr_delete_unused_trainee(
  actor_user_id UUID,
  target_user_id UUID,
  confirmation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor public.profiles;
  target public.profiles;
  deleted_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Account deletion requires a trusted server';
  END IF;
  IF actor_user_id IS NULL OR target_user_id IS NULL THEN
    RAISE EXCEPTION 'Account identifiers are required';
  END IF;
  IF actor_user_id = target_user_id THEN
    RAISE EXCEPTION 'You cannot delete your own account';
  END IF;

  -- Stable order also avoids opposite-order locks in simultaneous requests.
  -- Hold role/status rows until commit so revocation or promotion cannot race
  -- the authorization and target checks.
  PERFORM id FROM public.profiles
    WHERE id IN (actor_user_id, target_user_id) ORDER BY id FOR UPDATE;
  SELECT * INTO actor FROM public.profiles WHERE id = actor_user_id;
  IF actor.id IS NULL OR NOT actor.is_admin OR NOT actor.is_active THEN
    RAISE EXCEPTION 'Only active DTR administrators can delete trainee accounts';
  END IF;
  SELECT * INTO target FROM public.profiles WHERE id = target_user_id;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'Account was not found. Refresh the account list';
  END IF;
  IF target.is_admin THEN
    RAISE EXCEPTION 'Administrator accounts cannot be deleted here';
  END IF;
  IF confirmation IS DISTINCT FROM target_user_id::text THEN
    RAISE EXCEPTION 'Type the exact account ID to confirm deletion';
  END IF;
  IF EXISTS (SELECT 1 FROM public.dtr_entries WHERE user_id = target_user_id) THEN
    RAISE EXCEPTION 'Accounts with DTR history cannot be deleted. Use deactivation instead';
  END IF;

  -- Do not orphan files should Storage be used in a future milestone.
  IF EXISTS (SELECT 1 FROM storage.objects WHERE owner_id = target_user_id::text) THEN
    RAISE EXCEPTION 'This account owns stored files and cannot be deleted here';
  END IF;

  -- Auth-owned dependent rows and the empty trainee profile cascade. The DTR
  -- RESTRICT constraint remains the final guard, including concurrent inserts.
  DELETE FROM auth.users WHERE id = target_user_id RETURNING id INTO deleted_id;
  IF deleted_id IS NULL THEN
    RAISE EXCEPTION 'Account was not found. Refresh the account list';
  END IF;
  RETURN deleted_id;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Account deletion was blocked by related records. Use deactivation instead';
END;
$$;

REVOKE ALL ON FUNCTION public.dtr_delete_unused_trainee(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dtr_delete_unused_trainee(UUID, UUID, TEXT) TO service_role;

COMMIT;
