-- Restore legacy validation only when no current profile depends on the new field.
do $$ begin
 if exists(select 1 from hs.profiles where criteria->'geography' ? 'mode') then
  raise exception 'Restore profiles to legacy location criteria before rolling back location modes';
 end if;
end; $$;

create or replace function hs.valid_criteria(c jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,hs as $$ begin
 return coalesce(hs.valid_criteria_base(c-'sourceIds') and (not(c ? 'sourceIds') or (jsonb_typeof(c->'sourceIds')='array' and jsonb_array_length(c->'sourceIds') between 1 and 20
  and not exists(select 1 from jsonb_array_elements(c->'sourceIds') s where jsonb_typeof(s)<>'string' or s#>>'{}' !~ '^[a-z0-9-]{1,60}$'))),false);
exception when others then return false; end; $$;
