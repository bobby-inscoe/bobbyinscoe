-- Housekeeping after the shared catalog.
-- Used ingest one-time codes are forgotten after `hs.nonce_retention()` (an hour), long after a request's own
-- five-minute window. The catalog migration dropped the purge that used to delete them, so each new code now clears the
-- old ones of its key. The hosted project's `public.rls_auto_enable()` is an event-trigger function; calling it through
-- the API already fails, but the security advisor flags it, so the API roles lose execute on it. Local databases do not
-- have it.
create or replace function public.hs_consume_nonce(p_key_id text,p_nonce text,p_timestamp bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ begin
 perform 1 from hs.ingest_credentials where key_id=p_key_id and revoked_at is null and expires_at>now() and 'ingest'=any(scopes) for share;
 if not found or p_timestamp is null or abs(extract(epoch from clock_timestamp())-p_timestamp)>300 then raise exception 'Credential or timestamp invalid' using errcode='42501'; end if;
 delete from hs.ingest_nonces where key_id=p_key_id and used_at<now()-hs.nonce_retention();
 insert into hs.ingest_nonces(key_id,nonce) values(p_key_id,p_nonce);
 return jsonb_build_object('ok',true);
end; $$;

delete from hs.ingest_nonces where used_at<now()-hs.nonce_retention();

do $$ begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
 end if;
end $$;
