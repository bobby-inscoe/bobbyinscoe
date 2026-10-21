-- Any member of a household can change or remove a manual listing of that household. Catalog listings are never touched.
-- The link itself stays fixed: it is what stops a duplicate, so a different link is a new listing.
-- The rules for the photo links and facts a member enters, shared by hs_add_manual and hs_update_manual.
create function hs.manual_extras_invalid(p_image_urls jsonb,p_facts jsonb) returns boolean language sql immutable set search_path=pg_catalog,hs as $$
 select p_image_urls is null or jsonb_typeof(p_image_urls)<>'array' or jsonb_array_length(p_image_urls)>10 or exists(select 1 from jsonb_array_elements(p_image_urls) u where jsonb_typeof(u)<>'string' or hs.text_length(u#>>'{}')>2048 or not hs.valid_bookmark_url(u#>>'{}') or u#>>'{}' not like 'https://%')
  or p_facts is null or jsonb_typeof(p_facts)<>'object' or exists(select 1 from jsonb_object_keys(p_facts) k where k not in ('propertyType','askingPriceSek','livingAreaM2','rooms','outdoor')) or (p_facts ? 'propertyType' and not coalesce((p_facts->>'propertyType') in ('apartment','house'),false)) or (p_facts ? 'outdoor' and not coalesce((p_facts->>'outdoor') in ('balcony','terrace','both','none'),false)) or (p_facts ? 'askingPriceSek' and not coalesce(case when jsonb_typeof(p_facts->'askingPriceSek')='number' then (p_facts->>'askingPriceSek')::numeric between 1 and 1000000000 and (p_facts->>'askingPriceSek')::numeric=trunc((p_facts->>'askingPriceSek')::numeric) end,false)) or (p_facts ? 'livingAreaM2' and not coalesce(case when jsonb_typeof(p_facts->'livingAreaM2')='number' then (p_facts->>'livingAreaM2')::numeric>0 and (p_facts->>'livingAreaM2')::numeric<=10000 end,false)) or (p_facts ? 'rooms' and not coalesce(case when jsonb_typeof(p_facts->'rooms')='number' then (p_facts->>'rooms')::numeric>0 and (p_facts->>'rooms')::numeric<=100 end,false)) $$;

create or replace function public.hs_add_manual(p_household_id uuid,p_url text,p_title text,p_note text,p_tags jsonb,p_image_urls jsonb default '[]',p_facts jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ declare lid uuid; begin
 perform hs.require_member(p_household_id);
 if p_url is null or p_title is null or p_note is null or p_tags is null or hs.text_length(p_url)>2048 or not hs.valid_bookmark_url(p_url) or hs.text_length(p_title)>200 or hs.text_length(p_note)>2000 or jsonb_typeof(p_tags)<>'array' or jsonb_array_length(p_tags)>10 or exists(select 1 from jsonb_array_elements(p_tags) tag where jsonb_typeof(tag)<>'string' or hs.text_length(tag#>>'{}') not between 1 and 40) then raise exception 'Invalid bookmark'; end if;
 if hs.manual_extras_invalid(p_image_urls,p_facts) then raise exception 'Invalid bookmark'; end if;
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

create function public.hs_update_manual(p_household_id uuid,p_listing_id uuid,p_title text,p_image_urls jsonb,p_facts jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ begin
 perform hs.require_member(p_household_id);
 if p_listing_id is null or p_title is null or hs.text_length(p_title)>200 or hs.manual_extras_invalid(p_image_urls,p_facts) then raise exception 'Invalid bookmark'; end if;
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 update hs.manual_listings set value=(value-'imageUrls') || jsonb_build_object('title',coalesce(nullif(btrim(p_title),''),'Saved listing'),'facts',p_facts) || case when jsonb_array_length(p_image_urls)=0 then '{}'::jsonb else jsonb_build_object('imageUrls',p_image_urls) end,last_changed_at=now()
  where id=p_listing_id and household_id=p_household_id;
 if not found then raise exception 'Listing unavailable'; end if;
 return jsonb_build_object('ok',true);
end; $$;

-- Favorites and notes of every member go with the listing; hides cascade.
create function public.hs_delete_manual(p_household_id uuid,p_listing_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ begin
 perform hs.require_member(p_household_id);
 if p_listing_id is null then raise exception 'Listing unavailable'; end if;
 perform 1 from hs.households where id=p_household_id for update;
 perform hs.require_member(p_household_id);
 perform 1 from hs.manual_listings where id=p_listing_id and household_id=p_household_id for update;
 if not found then raise exception 'Listing unavailable'; end if;
 delete from hs.favorites where household_id=p_household_id and manual_listing_id=p_listing_id;
 delete from hs.notes where household_id=p_household_id and manual_listing_id=p_listing_id;
 delete from hs.manual_listings where id=p_listing_id and household_id=p_household_id;
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.hs_update_manual(uuid,uuid,text,jsonb,jsonb),public.hs_delete_manual(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.hs_update_manual(uuid,uuid,text,jsonb,jsonb),public.hs_delete_manual(uuid,uuid) to authenticated;

revoke all on all functions in schema hs from public,anon,authenticated,service_role;
