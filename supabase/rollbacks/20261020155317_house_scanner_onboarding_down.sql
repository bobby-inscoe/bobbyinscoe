-- Reverses 20261020155317_house_scanner_onboarding.sql. Households and memberships created through links stay; archived
-- households lose their archive time, and their members stay inactive. Pending and used links are dropped.
begin;
drop function public.hs_invitation_create(text,uuid,text);
drop function public.hs_invitation_preview(text);
drop function public.hs_invitation_reserve(text,text);
drop function public.hs_invitation_redeem(text,text,text);
drop function public.hs_household_access(uuid);
drop function public.hs_invitation_revoke(uuid,uuid);
drop function public.hs_household_rename(uuid,text);
drop function public.hs_member_make_owner(uuid,uuid);
drop function public.hs_member_deactivate(uuid,uuid);
drop function public.hs_household_leave(uuid);
drop function hs.live_invitation(text);
drop function hs.token_hash(text);
drop function hs.starter_criteria();
drop function hs.clean_name(text);
drop table hs.invitations;
create or replace function public.hs_memberships() returns jsonb language sql stable security definer set search_path=pg_catalog,hs as $$
 select coalesce(jsonb_agg(jsonb_build_object('householdId',household_id,'userId',user_id,'displayName',display_name,'role',role) order by household_id),'[]'::jsonb)
 from hs.members where user_id=auth.uid() and active;
$$;
alter table hs.households drop column archived_at;
commit;
