-- Reverses 20261022120000_house_scanner_manual_edit.sql: edits and deletes stop; listings already deleted stay deleted.
begin;
drop function if exists public.hs_update_manual(uuid,uuid,text,jsonb,jsonb);
drop function if exists public.hs_delete_manual(uuid,uuid);
create or replace function public.hs_add_manual(p_household_id uuid,p_url text,p_title text,p_note text,p_tags jsonb,p_image_urls jsonb default '[]',p_facts jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ declare lid uuid; begin
 perform hs.require_member(p_household_id);
 if p_url is null or p_title is null or p_note is null or p_tags is null or hs.text_length(p_url)>2048 or not hs.valid_bookmark_url(p_url) or hs.text_length(p_title)>200 or hs.text_length(p_note)>2000 or jsonb_typeof(p_tags)<>'array' or jsonb_array_length(p_tags)>10 or exists(select 1 from jsonb_array_elements(p_tags) tag where jsonb_typeof(tag)<>'string' or hs.text_length(tag#>>'{}') not between 1 and 40) then raise exception 'Invalid bookmark'; end if;
 if p_image_urls is null or jsonb_typeof(p_image_urls)<>'array' or jsonb_array_length(p_image_urls)>10 or exists(select 1 from jsonb_array_elements(p_image_urls) u where jsonb_typeof(u)<>'string' or hs.text_length(u#>>'{}')>2048 or not hs.valid_bookmark_url(u#>>'{}') or u#>>'{}' not like 'https://%')
  or p_facts is null or jsonb_typeof(p_facts)<>'object' or exists(select 1 from jsonb_object_keys(p_facts) k where k not in ('propertyType','askingPriceSek','livingAreaM2','rooms','outdoor')) or (p_facts ? 'propertyType' and not coalesce((p_facts->>'propertyType') in ('apartment','house'),false)) or (p_facts ? 'outdoor' and not coalesce((p_facts->>'outdoor') in ('balcony','terrace','both','none'),false)) or (p_facts ? 'askingPriceSek' and not coalesce(case when jsonb_typeof(p_facts->'askingPriceSek')='number' then (p_facts->>'askingPriceSek')::numeric between 1 and 1000000000 and (p_facts->>'askingPriceSek')::numeric=trunc((p_facts->>'askingPriceSek')::numeric) end,false)) or (p_facts ? 'livingAreaM2' and not coalesce(case when jsonb_typeof(p_facts->'livingAreaM2')='number' then (p_facts->>'livingAreaM2')::numeric>0 and (p_facts->>'livingAreaM2')::numeric<=10000 end,false)) or (p_facts ? 'rooms' and not coalesce(case when jsonb_typeof(p_facts->'rooms')='number' then (p_facts->>'rooms')::numeric>0 and (p_facts->>'rooms')::numeric<=100 end,false)) then raise exception 'Invalid bookmark'; end if;
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 select id into lid from (
  select id from hs.manual_listings where household_id=p_household_id and canonical_url=p_url
  union all select l.id from hs.listings l where l.value->>'sourceUrl'=p_url and hs.catalog_visible(p_household_id,l.id)
 ) found order by id limit 1;
 if lid is not null then return jsonb_build_object('listingId',lid,'existing',true); end if;
 insert into hs.manual_listings(household_id,added_by,canonical_url,value) values(p_household_id,auth.uid(),p_url,jsonb_build_object('title',coalesce(nullif(btrim(p_title),''),'Saved listing'),'sourceUrls',jsonb_build_array(p_url),'userTags',p_tags,'facts',p_facts)||case when jsonb_array_length(p_image_urls)=0 then '{}'::jsonb else jsonb_build_object('imageUrls',p_image_urls) end) returning id into lid;
 if length(btrim(p_note))>0 then insert into hs.notes(household_id,manual_listing_id,user_id,bookmark_url,body) values(p_household_id,lid,auth.uid(),p_url,btrim(p_note)); end if;
 return jsonb_build_object('listingId',lid,'existing',false);
end; $$;
drop function if exists hs.manual_extras_invalid(jsonb,jsonb);
commit;
