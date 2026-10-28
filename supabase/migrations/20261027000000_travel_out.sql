BEGIN;
ALTER TABLE public.dtr_entries
 ADD COLUMN travel_hours integer,
 ADD COLUMN travel_place text,
 ADD COLUMN travel_reason text,
 ADD CONSTRAINT dtr_travel_shape CHECK (
   (travel_hours IS NULL AND travel_place IS NULL AND travel_reason IS NULL) OR
   (travel_hours IS NOT NULL AND travel_hours IN (8,10) AND travel_place IS NOT NULL AND char_length(btrim(travel_place)) BETWEEN 1 AND 15 AND travel_place ~ '[^[:space:]]'
    AND travel_reason IS NOT NULL AND char_length(btrim(travel_reason)) BETWEEN 1 AND 1000 AND travel_reason ~ '[^[:space:]]'
    AND check_in IS NULL AND break_out IS NULL AND break_in IS NULL AND check_out IS NULL)
 );
CREATE FUNCTION public.dtr_validate_travel() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.travel_hours IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=NEW.user_id AND NOT is_admin AND account_type IN ('job_order','regular_employee')) THEN
 RAISE EXCEPTION 'Travel is only available to JO and Regular attendance accounts' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.dtr_validate_travel() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER dtr_validate_travel BEFORE INSERT OR UPDATE ON public.dtr_entries FOR EACH ROW EXECUTE FUNCTION public.dtr_validate_travel();
CREATE FUNCTION public.dtr_travel_out(expected_date date, hours integer, place text, reason text)
RETURNS public.dtr_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; day date; saved public.dtr_entries;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 -- Same lock as punching/corrections/deactivation: only one operation can win.
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF p.id IS NULL OR NOT p.is_active OR p.is_admin OR p.account_type NOT IN ('job_order','regular_employee') THEN RAISE EXCEPTION 'This account cannot record travel' USING ERRCODE='42501'; END IF;
 day := (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date;
 IF expected_date IS DISTINCT FROM day THEN RAISE EXCEPTION 'Date changed. Reload attendance' USING ERRCODE='40001'; END IF;
 IF hours IS NULL OR hours NOT IN (8,10) OR place IS NULL OR char_length(btrim(place)) NOT BETWEEN 1 AND 15 OR reason IS NULL OR char_length(btrim(reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Choose 8 or 10 hours and supply a place (maximum 15 characters) and reason (maximum 1000 characters)'; END IF;
 IF EXISTS(SELECT 1 FROM public.dtr_entries WHERE user_id=p.id AND entry_date=day) THEN RAISE EXCEPTION 'Attendance already exists. Reload records; contact an administrator for corrections' USING ERRCODE='40001'; END IF;
 INSERT INTO public.dtr_entries(user_id,entry_date,travel_hours,travel_place,travel_reason) VALUES(p.id,day,hours,btrim(place),btrim(reason)) RETURNING * INTO saved;
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.dtr_travel_out(date,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dtr_travel_out(date,integer,text,text) TO authenticated;
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
  server_now := clock_timestamp();
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
  IF current_row.travel_hours IS NOT NULL THEN
    RAISE EXCEPTION 'Travel already recorded. Reload attendance' USING ERRCODE='40001';
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


CREATE OR REPLACE FUNCTION public.dtr_chief_approve(actor_user_id uuid, request_id uuid, credential text, new_password text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.profiles; t public.profiles; s dtr_private.chief_secret; r dtr_private.chief_requests;
  attempt dtr_private.chief_attempts; oldrow public.dtr_entries; saved public.dtr_entries;
  target_id uuid; date_key date; ci timestamptz; bo timestamptz; bi timestamptz; co timestamptz;
  th integer; tp text; tr text;
  expected jsonb; actual jsonb; outcome jsonb; recovery text; v integer; stamp timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Trusted server required' USING ERRCODE='42501'; END IF;
  -- Serialize approval and secret rotation. All functions use the same lock order.
  SELECT * INTO s FROM dtr_private.chief_secret WHERE singleton FOR UPDATE;
  IF s.singleton IS NULL THEN RETURN jsonb_build_object('error','Chief approval is not configured.'); END IF;
  SELECT * INTO r FROM dtr_private.chief_requests WHERE id=request_id AND actor_id=actor_user_id FOR UPDATE;
  IF r.id IS NULL THEN RETURN jsonb_build_object('error','Approval request not found. Start again.'); END IF;
  target_id := (r.payload->>'targetUserId')::uuid;
  PERFORM id FROM public.profiles WHERE id IN(actor_user_id,target_id) ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM public.profiles WHERE id=actor_user_id AND is_admin AND is_active;
  IF a.id IS NULL THEN RETURN jsonb_build_object('error','Active administrator access required.'); END IF;
  -- A retry can retrieve its own completed result, never apply another correction.
  -- Recovery codes are never retained in the replay result.
  IF r.result IS NOT NULL THEN RETURN r.result; END IF;
  stamp := clock_timestamp();
  IF r.expires_at<=stamp OR r.secret_version<>s.version THEN RETURN jsonb_build_object('error','Approval expired. Review the action and request approval again.'); END IF;
  INSERT INTO dtr_private.chief_attempts(actor_id) VALUES(actor_user_id) ON CONFLICT DO NOTHING;
  SELECT * INTO attempt FROM dtr_private.chief_attempts WHERE actor_id=actor_user_id FOR UPDATE;
  IF attempt.blocked_until>stamp THEN RETURN jsonb_build_object('error','Approval temporarily unavailable. Try again after 15 minutes.'); END IF;
  IF attempt.blocked_until IS NOT NULL THEN
    UPDATE dtr_private.chief_attempts SET failures=0,blocked_until=NULL WHERE actor_id=actor_user_id;
    attempt.failures:=0;
  END IF;
  IF credential IS NULL OR octet_length(credential)>72 OR length(credential)<1 OR
    (extensions.crypt(credential, CASE WHEN r.operation='recover_ssp' THEN s.recovery_hash ELSE s.password_hash END)
      IS DISTINCT FROM (CASE WHEN r.operation='recover_ssp' THEN s.recovery_hash ELSE s.password_hash END)
      AND (r.operation<>'recover_ssp' OR extensions.crypt(dtr_private.normalize_chief_recovery_code(credential),s.recovery_hash) IS DISTINCT FROM s.recovery_hash)) THEN
    UPDATE dtr_private.chief_attempts SET failures=attempt.failures+1,
      blocked_until=CASE WHEN attempt.failures+1>=5 THEN stamp+interval '15 minutes' ELSE NULL END WHERE actor_id=actor_user_id;
    -- Return, do not raise: failed-attempt accounting must commit.
    RETURN jsonb_build_object('error',CASE WHEN attempt.failures+1>=5 THEN 'Approval temporarily unavailable. Try again after 15 minutes.' ELSE 'Approval password or recovery code was not accepted. No changes saved.' END);
  END IF;
  UPDATE dtr_private.chief_attempts SET failures=0,blocked_until=NULL WHERE actor_id=actor_user_id;
  IF s.must_change AND r.operation IN('edit_dtr','delete_account') THEN RETURN jsonb_build_object('error','Change the temporary Chief Approval Password first.'); END IF;
  -- All operation writes plus audit plus idempotent result are one subtransaction.
  BEGIN
    IF r.operation='edit_dtr' THEN
      SELECT * INTO t FROM public.profiles WHERE id=target_id;
      IF t.id IS NULL OR t.is_admin THEN RETURN jsonb_build_object('error','Select a non-administrator attendance account.'); END IF;
      IF length(trim(coalesce(r.payload->>'reason','')))<3 OR length(r.payload->>'reason')>1000 THEN RETURN jsonb_build_object('error','A correction reason of 3 to 1000 characters is required.'); END IF;
      date_key := (r.payload->>'date')::date;
      IF date_key IS NULL OR date_key>(stamp AT TIME ZONE 'Asia/Manila')::date THEN RETURN jsonb_build_object('error','Attendance date must be today or earlier.'); END IF;
      SELECT * INTO oldrow FROM public.dtr_entries WHERE user_id=target_id AND entry_date=date_key FOR UPDATE;
      expected:=r.payload->'expected';
      actual:=CASE WHEN oldrow.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('id',oldrow.id,'check_in',oldrow.check_in,'break_out',oldrow.break_out,'break_in',oldrow.break_in,'check_out',oldrow.check_out) END;
      IF expected IS NULL OR (oldrow.id IS NULL AND expected<>'null'::jsonb) OR
         (oldrow.id IS NOT NULL AND (expected='null'::jsonb OR oldrow.id IS DISTINCT FROM (expected->>'id')::uuid OR
         oldrow.check_in IS DISTINCT FROM (expected->>'check_in')::timestamptz OR oldrow.break_out IS DISTINCT FROM (expected->>'break_out')::timestamptz OR
         oldrow.break_in IS DISTINCT FROM (expected->>'break_in')::timestamptz OR oldrow.check_out IS DISTINCT FROM (expected->>'check_out')::timestamptz OR oldrow.travel_hours IS DISTINCT FROM (expected->>'travel_hours')::integer OR oldrow.travel_place IS DISTINCT FROM (expected->>'travel_place') OR oldrow.travel_reason IS DISTINCT FROM (expected->>'travel_reason'))) THEN
        RETURN jsonb_build_object('error','Attendance changed. Reload records and review the correction again.'); END IF;
      ci:=(r.payload->'values'->>'check_in')::timestamptz; bo:=(r.payload->'values'->>'break_out')::timestamptz;
      bi:=(r.payload->'values'->>'break_in')::timestamptz; co:=(r.payload->'values'->>'check_out')::timestamptz;
      th := (r.payload->'values'->>'travel_hours')::integer;
      tp := nullif(btrim(r.payload->'values'->>'travel_place'), '');
      tr := nullif(btrim(r.payload->'values'->>'travel_reason'), '');
      IF th IS NOT NULL AND (t.account_type NOT IN ('job_order','regular_employee') OR th NOT IN (8,10) OR tp IS NULL OR char_length(tp)>15 OR tr IS NULL OR char_length(tr)>1000 OR ci IS NOT NULL OR bo IS NOT NULL OR bi IS NOT NULL OR co IS NOT NULL) THEN
        RETURN jsonb_build_object('error','Travel needs an eligible account, 8 or 10 hours, a place of up to 15 characters and a reason, with no punches.'); END IF;
      IF th IS NULL AND (tp IS NOT NULL OR tr IS NOT NULL) THEN RETURN jsonb_build_object('error','Travel hours are required with travel details.'); END IF;
      IF (ci IS NULL AND (bo IS NOT NULL OR bi IS NOT NULL OR co IS NOT NULL)) OR (bi IS NOT NULL AND bo IS NULL) OR
         (co IS NOT NULL AND ((bo IS NULL)<>(bi IS NULL))) OR bo<ci OR bi<=bo OR co<=ci OR co<bi OR
         EXISTS(SELECT 1 FROM unnest(ARRAY[ci,bo,bi,co]) x WHERE x IS NOT NULL AND (NOT isfinite(x) OR x>stamp OR (x AT TIME ZONE 'Asia/Manila')::date<>date_key)) THEN
        RETURN jsonb_build_object('error','Invalid attendance sequence. Use chronological punches on the selected Philippine date.'); END IF;
      IF oldrow.id IS NULL AND ci IS NULL AND th IS NULL THEN RETURN jsonb_build_object('error','A new entry needs a check-in.'); END IF;
      IF oldrow.id IS NOT NULL AND oldrow.check_in IS NOT DISTINCT FROM ci AND oldrow.break_out IS NOT DISTINCT FROM bo AND oldrow.break_in IS NOT DISTINCT FROM bi AND oldrow.check_out IS NOT DISTINCT FROM co AND oldrow.travel_hours IS NOT DISTINCT FROM th AND oldrow.travel_place IS NOT DISTINCT FROM tp AND oldrow.travel_reason IS NOT DISTINCT FROM tr THEN RETURN jsonb_build_object('error','No attendance changes to save.'); END IF;
      IF oldrow.id IS NULL THEN
        INSERT INTO public.dtr_entries(user_id,entry_date,check_in,break_out,break_in,check_out,travel_hours,travel_place,travel_reason) VALUES(target_id,date_key,ci,bo,bi,co,th,tp,tr) RETURNING * INTO saved;
      ELSE
        UPDATE public.dtr_entries SET check_in=ci,break_out=bo,break_in=bi,check_out=co,travel_hours=th,travel_place=tp,travel_reason=tr WHERE id=oldrow.id RETURNING * INTO saved;
      END IF;
      INSERT INTO public.dtr_admin_audit(request_id,action,affected_user,dtr_id,entry_date,old_values,new_values,reason,actor_id,actor_name,approval_method,ssp_version)
        VALUES(r.id,'dtr_corrected',target_id,saved.id,date_key,CASE WHEN oldrow.id IS NULL THEN NULL ELSE to_jsonb(oldrow) END,to_jsonb(saved),trim(r.payload->>'reason'),a.id,a.full_name,'chief_ssp',s.version);
      outcome:=jsonb_build_object('ok',true,'record',to_jsonb(saved));
    ELSIF r.operation='delete_account' THEN
      SELECT * INTO t FROM public.profiles WHERE id=target_id;
      IF t.id IS NULL OR t.is_admin OR t.id=a.id OR r.payload->>'confirmation' IS DISTINCT FROM target_id::text THEN RETURN jsonb_build_object('error','Only a confirmed unused non-administrator account can be deleted.'); END IF;
      IF EXISTS(SELECT 1 FROM public.dtr_entries WHERE user_id=t.id) OR EXISTS(SELECT 1 FROM public.dtr_admin_audit WHERE affected_user=t.id OR actor_id=t.id) OR EXISTS(SELECT 1 FROM storage.objects WHERE owner_id=t.id::text) THEN RETURN jsonb_build_object('error','This account has historical or protected records. Use deactivation instead.'); END IF;
      actual:=jsonb_build_object('id',t.id,'name',t.full_name,'email',(SELECT email FROM auth.users WHERE id=t.id),'account_type',t.account_type,'position',t.ojt_title);
      IF actual IS DISTINCT FROM r.payload->'account' THEN RETURN jsonb_build_object('error','Account details changed. Review deletion again.'); END IF;
      DELETE FROM auth.users WHERE id=t.id;
      INSERT INTO public.dtr_admin_audit(request_id,action,affected_user,old_values,actor_id,actor_name,approval_method,ssp_version)
        VALUES(r.id,'account_deleted',t.id,actual,a.id,a.full_name,'chief_ssp',s.version);
      outcome:=jsonb_build_object('ok',true,'deletedId',t.id);
    ELSE
      IF new_password IS NULL OR length(new_password)<12 OR octet_length(new_password)>72 OR new_password=credential THEN RETURN jsonb_build_object('error','Choose a different password of at least 12 characters and at most 72 UTF-8 bytes.'); END IF;
      v:=s.version+1;
      IF r.operation='recover_ssp' THEN recovery:=dtr_private.generate_chief_recovery_code(); END IF;
      UPDATE dtr_private.chief_secret SET password_hash=extensions.crypt(new_password,extensions.gen_salt('bf',12)), version=v,must_change=false,
        recovery_hash=CASE WHEN recovery IS NULL THEN recovery_hash ELSE extensions.crypt(dtr_private.normalize_chief_recovery_code(recovery),extensions.gen_salt('bf',12)) END WHERE singleton;
      INSERT INTO public.dtr_admin_audit(request_id,action,actor_id,actor_name,approval_method,ssp_version,old_values,new_values)
        VALUES(r.id,CASE WHEN r.operation='recover_ssp' THEN 'chief_ssp_recovered' ELSE 'chief_ssp_changed' END,a.id,a.full_name,CASE WHEN r.operation='recover_ssp' THEN 'recovery_code' ELSE 'chief_ssp' END,v,jsonb_build_object('version',s.version),jsonb_build_object('version',v));
      outcome:=jsonb_build_object('ok',true,'version',v);
    END IF;
    UPDATE dtr_private.chief_requests SET result=outcome WHERE id=r.id;
    RETURN CASE WHEN recovery IS NULL THEN outcome ELSE outcome||jsonb_build_object('recoveryCode',recovery) END;
  EXCEPTION WHEN foreign_key_violation THEN RETURN jsonb_build_object('error','Protected related records prevent this action. Use deactivation instead.');
    WHEN OTHERS THEN RETURN jsonb_build_object('error','The operation was not saved. Reload records and review the request.');
  END;
END $$;
REVOKE ALL ON FUNCTION public.dtr_chief_approve(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dtr_chief_approve(uuid,uuid,text,text) TO service_role;

DROP FUNCTION public.dtr_security_logs(date,uuid);
CREATE FUNCTION public.dtr_security_logs(log_date date, after_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, full_name text, account_type public.account_type,
 check_in timestamptz, break_out timestamptz, break_in timestamptz, check_out timestamptz, travel_hours integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM dtr_private.security_monitors WHERE user_id=auth.uid() AND is_active
  ) THEN RAISE EXCEPTION 'Security monitor access is unavailable' USING ERRCODE='42501'; END IF;
  IF log_date IS NULL OR log_date > (now() AT TIME ZONE 'Asia/Manila')::date THEN
    RAISE EXCEPTION 'Choose today or a previous date';
  END IF;
  RETURN QUERY SELECT d.id, p.full_name, p.account_type, d.check_in, d.break_out, d.break_in, d.check_out, d.travel_hours
    FROM public.dtr_entries d JOIN public.profiles p ON p.id=d.user_id
    WHERE d.entry_date=log_date AND NOT p.is_admin AND (after_id IS NULL OR d.id>after_id)
    ORDER BY d.id LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.dtr_security_logs(date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dtr_security_logs(date,uuid) TO authenticated;

COMMIT;
