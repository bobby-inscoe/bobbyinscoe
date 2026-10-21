-- Reverses 20261020190838_house_scanner_maintenance.sql: one-time codes are kept again, and the API roles get execute on
-- the hosted RLS helper back. Codes already deleted stay deleted.
begin;
create or replace function public.hs_consume_nonce(p_key_id text,p_nonce text,p_timestamp bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ begin
 perform 1 from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes) for share;
 if not found or p_timestamp is null or abs(extract(epoch from clock_timestamp())-p_timestamp)>300 then raise exception 'Credential or timestamp invalid' using errcode='42501'; end if;
 insert into hs.ingest_nonces(key_id,nonce) values(p_key_id,p_nonce);
 return jsonb_build_object('ok',true);
end; $$;
do $$ begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  grant execute on function public.rls_auto_enable() to anon,authenticated;
 end if;
end $$;
commit;
