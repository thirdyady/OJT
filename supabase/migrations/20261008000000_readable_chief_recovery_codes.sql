BEGIN;

-- New codes contain 12 independent random letters (~54 bits), displayed in groups.
-- Rejection sampling avoids modulo bias. Existing credential hashes remain unchanged.
CREATE FUNCTION dtr_private.generate_chief_recovery_code()
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE alphabet CONSTANT text := 'ABCDEFGHJKMNPQRSTUVWXYZ'; code text := ''; sample integer;
BEGIN
  WHILE length(code)<12 LOOP
    sample:=get_byte(extensions.gen_random_bytes(1),0);
    IF sample<253 THEN code:=code||substr(alphabet,(sample%23)+1,1); END IF;
  END LOOP;
  RETURN substr(code,1,4)||'-'||substr(code,5,4)||'-'||substr(code,9,4);
END $$;

CREATE FUNCTION dtr_private.normalize_chief_recovery_code(code text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE compact text := translate(regexp_replace(code,'[[:space:]-]','','g'),
  'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ');
BEGIN
  IF compact ~ '^[A-HJKMNP-Z]{12}$' THEN RETURN compact; END IF;
  -- Legacy codes keep their original case and punctuation.
  RETURN code;
END $$;
REVOKE ALL ON FUNCTION dtr_private.generate_chief_recovery_code() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION dtr_private.normalize_chief_recovery_code(text) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve every approval, audit, lockout, replay and attendance rule. Only
-- recovery-code generation/verification changes; passwords remain case-sensitive.
CREATE OR REPLACE FUNCTION public.dtr_chief_approve(actor_user_id uuid, request_id uuid, credential text, new_password text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.profiles; t public.profiles; s dtr_private.chief_secret; r dtr_private.chief_requests;
  attempt dtr_private.chief_attempts; oldrow public.dtr_entries; saved public.dtr_entries;
  target_id uuid; date_key date; ci timestamptz; bo timestamptz; bi timestamptz; co timestamptz;
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
         oldrow.break_in IS DISTINCT FROM (expected->>'break_in')::timestamptz OR oldrow.check_out IS DISTINCT FROM (expected->>'check_out')::timestamptz)) THEN
        RETURN jsonb_build_object('error','Attendance changed. Reload records and review the correction again.'); END IF;
      ci:=(r.payload->'values'->>'check_in')::timestamptz; bo:=(r.payload->'values'->>'break_out')::timestamptz;
      bi:=(r.payload->'values'->>'break_in')::timestamptz; co:=(r.payload->'values'->>'check_out')::timestamptz;
      IF (ci IS NULL AND (bo IS NOT NULL OR bi IS NOT NULL OR co IS NOT NULL)) OR (bi IS NOT NULL AND bo IS NULL) OR
         (co IS NOT NULL AND ((bo IS NULL)<>(bi IS NULL))) OR bo<ci OR bi<=bo OR co<=ci OR co<bi OR
         EXISTS(SELECT 1 FROM unnest(ARRAY[ci,bo,bi,co]) x WHERE x IS NOT NULL AND (NOT isfinite(x) OR x>stamp OR (x AT TIME ZONE 'Asia/Manila')::date<>date_key)) THEN
        RETURN jsonb_build_object('error','Invalid attendance sequence. Use chronological punches on the selected Philippine date.'); END IF;
      IF oldrow.id IS NULL AND ci IS NULL THEN RETURN jsonb_build_object('error','A new entry needs a check-in.'); END IF;
      IF oldrow.id IS NOT NULL AND oldrow.check_in IS NOT DISTINCT FROM ci AND oldrow.break_out IS NOT DISTINCT FROM bo AND oldrow.break_in IS NOT DISTINCT FROM bi AND oldrow.check_out IS NOT DISTINCT FROM co THEN RETURN jsonb_build_object('error','No attendance changes to save.'); END IF;
      IF oldrow.id IS NULL THEN
        INSERT INTO public.dtr_entries(user_id,entry_date,check_in,break_out,break_in,check_out) VALUES(target_id,date_key,ci,bo,bi,co) RETURNING * INTO saved;
      ELSE
        UPDATE public.dtr_entries SET check_in=ci,break_out=bo,break_in=bi,check_out=co WHERE id=oldrow.id RETURNING * INTO saved;
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
COMMIT;
