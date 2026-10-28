BEGIN;

CREATE TABLE public.processing_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 start_date date NOT NULL CHECK(start_date BETWEEN '0001-01-01' AND '9999-12-31'),
 end_date date,
 required_workdays integer NOT NULL CHECK (required_workdays > 0),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (end_date IS NULL OR (end_date >= start_date AND end_date <= '9999-12-31')),
 UNIQUE(user_id, start_date)
);
COMMENT ON TABLE public.processing_contracts IS 'Processing progress periods only. DTR rows are never moved or deleted. Untouched initial provisioning metadata may cascade with an unused account; audited contracts protect deletion.';
CREATE TABLE public.processing_contract_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL,
 request_id uuid NOT NULL UNIQUE,
 request_values jsonb NOT NULL,
 old_values jsonb NOT NULL,
 new_values jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.processing_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_contract_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.processing_contracts, public.processing_contract_audit FROM anon, authenticated;
GRANT ALL ON public.processing_contracts, public.processing_contract_audit TO service_role;
GRANT SELECT ON public.processing_contracts, public.processing_contract_audit TO authenticated;
CREATE POLICY contracts_read ON public.processing_contracts FOR SELECT TO authenticated USING (
 (user_id = auth.uid() AND public.dtr_is_active()) OR public.dtr_admin_can_view_profile(user_id));
CREATE POLICY contract_audit_read ON public.processing_contract_audit FOR SELECT TO authenticated USING (public.dtr_admin_can_view_profile(user_id));

-- No fabricated contract date: the initial legacy period includes all history.
INSERT INTO public.processing_contracts(user_id,start_date,required_workdays)
 SELECT id, '0001-01-01', required_workdays FROM public.profiles WHERE account_type='processing' AND NOT is_admin;
CREATE FUNCTION public.dtr_validate_processing_contract() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM id FROM public.profiles WHERE id=NEW.user_id AND account_type='processing' AND NOT is_admin FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contracts are only available to Processing accounts'; END IF;
 IF EXISTS(SELECT 1 FROM public.processing_contracts WHERE user_id=NEW.user_id AND id<>NEW.id
 AND start_date<=coalesce(NEW.end_date,'infinity'::date) AND coalesce(end_date,'infinity'::date)>=NEW.start_date)
 THEN RAISE EXCEPTION 'Contract periods cannot overlap'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.dtr_validate_processing_contract() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_processing_contract BEFORE INSERT OR UPDATE ON public.processing_contracts
FOR EACH ROW EXECUTE FUNCTION public.dtr_validate_processing_contract();

CREATE FUNCTION public.dtr_initialize_processing_contract() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.account_type='processing' AND NOT NEW.is_admin THEN
  INSERT INTO public.processing_contracts(user_id,start_date,required_workdays)
  VALUES(NEW.id, (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date, NEW.required_workdays);
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.dtr_initialize_processing_contract() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER initialize_processing_contract AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.dtr_initialize_processing_contract();

CREATE FUNCTION public.dtr_save_processing_contract(
 target_user_id uuid, contract_id uuid, expected_revision integer,
 starts date, ends date, days integer, correction_reason text, operation_id uuid, expected_latest_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor uuid := auth.uid();
 previous public.processing_contracts;
 existing public.processing_contract_audit;
 old_rows jsonb;
 new_rows jsonb;
 payload jsonb := jsonb_build_array(contract_id,expected_revision,starts,ends,days,correction_reason,expected_latest_id);
BEGIN
 -- Stable profile locks serialize role revocation, deletion and competing renewals.
 PERFORM id FROM public.profiles WHERE id IN (actor,target_user_id) ORDER BY id FOR UPDATE;
 IF NOT public.dtr_is_admin() THEN RAISE EXCEPTION 'Only active administrators can manage contracts' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=target_user_id AND account_type='processing' AND NOT is_admin)
 THEN RAISE EXCEPTION 'Select a Processing account'; END IF;
 IF operation_id IS NULL OR starts IS NULL OR days IS NULL OR days <= 0 OR
 ends < starts OR nullif(btrim(correction_reason), '') IS NULL OR length(correction_reason)>1000 OR correction_reason !~ '[^[:space:]]'
 THEN RAISE EXCEPTION 'Provide valid dates, positive whole workdays and a correction reason'; END IF;
 SELECT * INTO existing FROM public.processing_contract_audit WHERE request_id=operation_id;
 IF FOUND THEN
  IF existing.actor_id=actor AND existing.user_id=target_user_id AND existing.request_values=payload THEN RETURN; END IF;
  RAISE EXCEPTION 'Request identifier already used';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY start_date),'[]') INTO old_rows FROM public.processing_contracts c WHERE user_id=target_user_id;
 IF contract_id IS NULL THEN
  SELECT * INTO previous FROM public.processing_contracts WHERE user_id=target_user_id ORDER BY start_date DESC LIMIT 1;
  IF previous.id IS NULL OR previous.id IS DISTINCT FROM expected_latest_id OR previous.revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'Contract changed. Reload before renewing'; END IF;
  IF ends IS NULL OR starts <= previous.start_date OR (previous.end_date IS NOT NULL AND starts <= previous.end_date)
  THEN RAISE EXCEPTION 'Renewal must follow the previous contract without overlapping'; END IF;
  IF previous.end_date IS NULL THEN
   UPDATE public.processing_contracts SET end_date=starts-1, revision=revision+1 WHERE id=previous.id;
  END IF;
  INSERT INTO public.processing_contracts(user_id,start_date,end_date,required_workdays) VALUES(target_user_id,starts,ends,days);
 ELSE
  SELECT * INTO previous FROM public.processing_contracts WHERE id=contract_id AND user_id=target_user_id FOR UPDATE;
  IF previous.id IS NULL OR previous.revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'Contract changed. Reload before saving'; END IF;
  IF ends IS NULL AND previous.end_date IS NOT NULL THEN RAISE EXCEPTION 'An end date is required'; END IF;
  IF EXISTS(SELECT 1 FROM public.processing_contracts WHERE user_id=target_user_id AND id<>contract_id
    AND start_date <= coalesce(ends,'infinity'::date) AND coalesce(end_date,'infinity'::date)>=starts)
  THEN RAISE EXCEPTION 'Contract periods cannot overlap'; END IF;
  UPDATE public.processing_contracts SET start_date=starts,end_date=ends,required_workdays=days,revision=revision+1 WHERE id=contract_id;
 END IF;
 SELECT jsonb_agg(to_jsonb(c) ORDER BY start_date) INTO new_rows FROM public.processing_contracts c WHERE user_id=target_user_id;
 INSERT INTO public.processing_contract_audit(user_id,actor_id,request_id,request_values,old_values,new_values,reason)
 VALUES(target_user_id,actor,operation_id,payload,old_rows,new_rows,btrim(correction_reason));
END; $$;
REVOKE ALL ON FUNCTION public.dtr_save_processing_contract(uuid,uuid,integer,date,date,integer,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dtr_save_processing_contract(uuid,uuid,integer,date,date,integer,text,uuid,uuid) TO authenticated;
COMMIT;
