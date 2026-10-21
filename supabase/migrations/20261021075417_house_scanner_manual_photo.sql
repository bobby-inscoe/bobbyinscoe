-- A manual link can carry up to ten photo addresses and a few facts the member entered: type, price, living area, rooms,
-- outdoor space. The browser hotlinks it; nothing is fetched or stored.
-- The old five-argument form is dropped so the named-argument call stays unambiguous.
drop function if exists public.hs_add_manual(uuid,text,text,text,jsonb);
create function public.hs_add_manual(p_household_id uuid,p_url text,p_title text,p_note text,p_tags jsonb,p_image_urls jsonb default '[]',p_facts jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$ declare lid uuid; begin
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
revoke all on function public.hs_add_manual(uuid,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.hs_add_manual(uuid,text,text,text,jsonb,jsonb,jsonb) to authenticated;

create or replace function hs.snapshot_base(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare visible jsonb; edition jsonb; people jsonb; profiles jsonb; favorites jsonb;
begin
 perform hs.require_member(p_household_id);
 select jsonb_build_object('id',id,'publishedAt',published_at,'coverage',coverage,'sourceSummary',source_summary) into edition from hs.editions order by published_at desc,id desc limit 1;
 select coalesce(jsonb_agg(item order by observed_at desc,id),'[]'::jsonb) into visible from (
 select l.id,l.observed_at,jsonb_build_object(
 'id',l.id,'householdId',p_household_id,'origin','source','sourceId',l.source_id,'title',l.value->>'title',
 'sourceUrls',jsonb_build_array(l.value->>'sourceUrl'),
 'facts',v.facts,
 'conflicts',v.conflicts,
 'coordinates',case when (l.value->'coordinates'->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) and (l.value->'coordinates'->>'observedAt')::timestamptz<=now()+interval '5 minutes' then l.value->'coordinates' else 'null'::jsonb end,
 'evidence',coalesce((select jsonb_agg(e) from jsonb_array_elements(l.value->'evidence') e where p.policy->'allowedEvidenceSubjects' ? (e->>'subject') and e->>'kind' in ('source_claim','measurement') and (e->>'sourceUrl' is null or p.policy->'listingOrigins' ? hs.origin(e->>'sourceUrl')) and (e->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int)),'[]'::jsonb),
 'photo',case when hs.policy_current(p.policy) and coalesce((p.policy->>'imageDisplay')::boolean,false) and coalesce((p.policy->>'imageHotlink')::boolean,false) and p.policy->'imageOrigins' ? hs.origin(l.value->'photo'->>'url') and (l.value->'photo'->>'expiresAt')::timestamptz>now() and (l.value->'photo'->>'observedAt')::timestamptz>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) then l.value->'photo' else 'null'::jsonb end,
 'previousAskingPriceSek',case when p.policy->'allowedFactFields' ? 'askingPriceSek' and not(l.value->'conflicts' ? 'askingPriceSek') and l.previous_price_observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int) then l.previous_asking_price else null end,
 'observedAt',l.observed_at,'addedBy',null,'userTags','[]'::jsonb
 )||case when l.delisted_at is null then '{}'::jsonb else jsonb_build_object('delistedAt',l.delisted_at) end item
 from hs.listings l join hs.source_policies p on p.source_id=l.source_id,
 lateral (select hs.empty_facts() || coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(l.value->'facts') f where p.policy->'allowedFactFields' ? f.key),'{}'::jsonb) facts,
  coalesce((select jsonb_agg(c) from jsonb_array_elements(l.value->'conflicts') c where p.policy->'allowedFactFields' ? (c#>>'{}')),'[]'::jsonb) conflicts) v
 where hs.listing_interacted(p_household_id,l.id) or (hs.policy_current(p.policy) and p.policy->'listingOrigins' ? hs.origin(l.value->>'sourceUrl') and l.observed_at>=now()-make_interval(days=>(p.policy->>'retentionDays')::int)
  and (exists(select 1 from hs.hidden_listings h where h.household_id=p_household_id and h.listing_id=l.id)
   or (l.delisted_at is null and exists(select 1 from hs.profiles pr where pr.household_id=p_household_id and pr.enabled and not hs.fails_hard_rule(v.facts,v.conflicts,pr.criteria,l.source_id)))))
 union all
 select m.id,m.observed_at,jsonb_build_object(
 'id',m.id,'householdId',m.household_id,'origin','manual','title',m.value->>'title','sourceUrls',m.value->'sourceUrls',
 'facts',hs.empty_facts()||coalesce(m.value->'facts','{}'::jsonb),'conflicts','[]'::jsonb,'coordinates','null'::jsonb,'evidence','[]'::jsonb,'photo',case when m.value ? 'imageUrls' then (select p from jsonb_array_elements(m.value->'imageUrls') with ordinality u(url,n),lateral (select jsonb_build_object('url',u.url#>>'{}','attribution','Added by a household member','rightsBasis','Linked by a household member, not stored.','expiresAt',m.observed_at+interval '1 year','observedAt',m.observed_at,'displayAllowed',true,'hotlinkAllowed',true) p) x order by n limit 1) else 'null'::jsonb end,
 'photos',case when m.value ? 'imageUrls' then (select jsonb_agg(jsonb_build_object('url',u.url#>>'{}','attribution','Added by a household member','rightsBasis','Linked by a household member, not stored.','expiresAt',m.observed_at+interval '1 year','observedAt',m.observed_at,'displayAllowed',true,'hotlinkAllowed',true) order by n) from jsonb_array_elements(m.value->'imageUrls') with ordinality u(url,n)) else '[]'::jsonb end,
 'previousAskingPriceSek',null,'observedAt',m.observed_at,'addedBy',m.added_by,'userTags',m.value->'userTags'
 ) from hs.manual_listings m where m.household_id=p_household_id
 ) permitted;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',household_id,'userId',user_id,'displayName',display_name,'role',role) order by user_id),'[]'::jsonb) into people from hs.members where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'householdId',household_id,'revision',revision,'name',name,'enabled',enabled,'criteria',criteria,'editedBy',edited_by,'editedAt',edited_at) order by id),'[]'::jsonb) into profiles from hs.profiles where household_id=p_household_id;
 select coalesce(jsonb_agg(jsonb_build_object('householdId',f.household_id,'listingId',coalesce(f.listing_id,f.manual_listing_id),'userId',f.user_id,'savedAt',saved_at) order by saved_at),'[]'::jsonb) into favorites from hs.favorites f join hs.members m on m.household_id=f.household_id and m.user_id=f.user_id where f.household_id=p_household_id and exists(select 1 from jsonb_array_elements(visible) v where v->>'id'=coalesce(f.listing_id,f.manual_listing_id)::text);
 if jsonb_array_length(visible)>1500 or jsonb_array_length(people)>10 or jsonb_array_length(profiles)>20 or jsonb_array_length(favorites)>5000 then raise exception 'Household exceeds snapshot limit; refine backend delivery before continuing'; end if;
 return jsonb_build_object('contractVersion',1,'householdId',p_household_id,'edition',edition,'listings',visible,'members',people,'profiles',profiles,'favorites',favorites);
end; $$;

revoke all on all functions in schema hs from public,anon,authenticated,service_role;
