-- Optional hideUnknownPrice keeps homes with no or a disputed asking price out of a profile's matches.
-- Strip it before the existing validation and check that it is a boolean.
create or replace function hs.valid_criteria(c jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,hs as $$
begin
 return coalesce(
  (not(c->'geography' ? 'mode') or c->'geography'->>'mode' in ('municipalities','radius'))
  and hs.valid_criteria_base((c-'sourceIds'-'financing'-'hideUnknownPrice') #- '{geography,mode}')
  and (not(c ? 'hideUnknownPrice') or jsonb_typeof(c->'hideUnknownPrice')='boolean')
  and (not(c ? 'sourceIds') or (jsonb_typeof(c->'sourceIds')='array' and jsonb_array_length(c->'sourceIds') between 1 and 20
   and not exists(select 1 from jsonb_array_elements(c->'sourceIds') s where jsonb_typeof(s)<>'string' or s#>>'{}' !~ '^[a-z0-9-]{1,60}$')))
  and (not(c ? 'financing') or (jsonb_typeof(c->'financing')='object' and (select count(*) from jsonb_object_keys(c->'financing'))=3
   and (c->'financing'->'cashSek'='null'::jsonb or hs.number_in(c->'financing','cashSek',0,1000000000,true))
   and hs.number_in(c->'financing','interestRatePercent',0,20)
   and jsonb_typeof(c->'financing'->'taxDeduction')='boolean')),false);
exception when others then return false;
end; $$;
