-- Accept a lead photo and up to seven additional photos. Floor plans stay separate.
begin;
create or replace function hs.assert_observation(p hs.sources, o jsonb) returns void language plpgsql set search_path=pg_catalog,hs as $$
declare img jsonb; begin
 perform hs.assert_observation_facts(p,o);
 if o ? 'morePhotos' and (jsonb_typeof(o->'morePhotos') is distinct from 'array' or jsonb_array_length(o->'morePhotos') not between 1 and 7
  or jsonb_typeof(o->'photo') is distinct from 'object') then raise exception 'Photo not permitted'; end if;
 for img in select x from jsonb_array_elements(coalesce(o->'morePhotos','[]'::jsonb)) x union all select o->'floorPlan' where o ? 'floorPlan' loop
  if jsonb_typeof(img) is distinct from 'object' or not coalesce(hs.origin(img->>'url')=any(p.image_origins) and (img->>'expiresAt')::timestamptz>now()
   and (img->>'observedAt')::timestamptz between now()-hs.retention() and now()+interval '5 minutes',false) then
   raise exception 'Photo not permitted'; end if;
 end loop;
end; $$;
commit;
