BEGIN;

-- No attendance rows or administrator correction policies are changed.
CREATE OR REPLACE FUNCTION public.dtr_punch(
  action TEXT,
  expected_date DATE,
  expected_id UUID,
  expected_check_in TIMESTAMPTZ,
  expected_break_out TIMESTAMPTZ,
  expected_break_in TIMESTAMPTZ,
  expected_check_out TIMESTAMPTZ,
  undo BOOLEAN DEFAULT false
)
RETURNS public.dtr_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  caller UUID := auth.uid();
  caller_active BOOLEAN;
  current_row public.dtr_entries;
  saved_row public.dtr_entries;
  server_now TIMESTAMPTZ;
  today DATE;
  fields TEXT[] := ARRAY['check_in', 'break_out', 'break_in', 'check_out'];
  stamps TIMESTAMPTZ[];
  action_index INTEGER;
  next_index INTEGER;
  last_index INTEGER;
  i INTEGER;
BEGIN
  IF caller IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Sign in before recording attendance' USING ERRCODE = '42501';
  END IF;
  -- Retain the signature so old clients can punch, but never undo.
  IF undo IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Self-service undo is unavailable. Contact an administrator for corrections' USING ERRCODE = '42501';
  END IF;
  -- Serialize even first punches (where no DTR row exists yet), and hold
  -- account status stable until commit. Deactivation uses the same row lock.
  SELECT is_active INTO caller_active FROM public.profiles WHERE id = caller FOR UPDATE;
  IF caller_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'This account cannot record attendance' USING ERRCODE = '42501';
  END IF;
  server_now := clock_timestamp(); asia manila 
  today := (server_now AT TIME ZONE 'Asia/Manila')::date;
  IF expected_date IS DISTINCT FROM today THEN
    RAISE EXCEPTION 'The attendance date changed. Reload records before trying again' USING ERRCODE = '40001';
  END IF;
  action_index := array_position(fields, action);
  IF action_index IS NULL OR undo IS NULL THEN
    RAISE EXCEPTION 'Invalid attendance action';
  END IF;
  SELECT * INTO current_row FROM public.dtr_entries
    WHERE user_id = caller AND entry_date = today FOR UPDATE;
  IF current_row.id IS DISTINCT FROM expected_id
    OR current_row.check_in IS DISTINCT FROM expected_check_in
    OR current_row.break_out IS DISTINCT FROM expected_break_out
    OR current_row.break_in IS DISTINCT FROM expected_break_in
    OR current_row.check_out IS DISTINCT FROM expected_check_out THEN
    RAISE EXCEPTION 'Attendance changed. Reload records before trying again' USING ERRCODE = '40001';
  END IF;
  stamps := ARRAY[current_row.check_in, current_row.break_out, current_row.break_in, current_row.check_out];
  FOR i IN 1..4 LOOP
    IF stamps[i] IS NOT NULL THEN last_index := i;
    ELSIF next_index IS NULL THEN next_index := i;
    END IF;
  END LOOP;
  IF next_index IS DISTINCT FROM action_index OR (last_index IS NOT NULL AND last_index > action_index) THEN
    RAISE EXCEPTION 'Punches must be recorded in order. Contact an administrator for inconsistent records';
  END IF;
  IF last_index IS NOT NULL AND server_now <= stamps[last_index] THEN
    RAISE EXCEPTION 'The saved punch is ahead of server time. Contact an administrator';
  END IF;
  stamps[action_index] := server_now;
  IF current_row.id IS NULL THEN
    INSERT INTO public.dtr_entries (user_id, entry_date, check_in)
      VALUES (caller, today, stamps[1]) RETURNING * INTO saved_row;
  ELSE
    UPDATE public.dtr_entries SET check_in = stamps[1], break_out = stamps[2],
      break_in = stamps[3], check_out = stamps[4]
      WHERE id = current_row.id RETURNING * INTO saved_row;
  END IF;
  RETURN saved_row;
END;
$$;
REVOKE ALL ON FUNCTION public.dtr_punch(TEXT, DATE, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dtr_punch(TEXT, DATE, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) TO authenticated;

COMMIT;
