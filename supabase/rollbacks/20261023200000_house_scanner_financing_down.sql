-- Removing financing is safe: it only feeds client-side cost estimates. Strip it so every profile still validates.
update hs.profiles set criteria=criteria-'financing' where criteria ? 'financing';

create or replace function hs.valid_criteria(c jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,hs as $$
begin
 return coalesce(
  (not(c->'geography' ? 'mode') or c->'geography'->>'mode' in ('municipalities','radius'))
  and hs.valid_criteria_base((c-'sourceIds') #- '{geography,mode}')
  and (not(c ? 'sourceIds') or (jsonb_typeof(c->'sourceIds')='array' and jsonb_array_length(c->'sourceIds') between 1 and 20
   and not exists(select 1 from jsonb_array_elements(c->'sourceIds') s where jsonb_typeof(s)<>'string' or s#>>'{}' !~ '^[a-z0-9-]{1,60}$'))),false);
exception when others then return false;
end; $$;
