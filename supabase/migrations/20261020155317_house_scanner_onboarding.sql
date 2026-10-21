-- Household onboarding (specs: shared catalog S5, household onboarding).
-- Two invitation purposes: `create` lets one account create its own household, `join` adds one named email to a
-- household. Tokens are 64 hex characters, one use, valid for 7 days, and stored only as SHA-256 hashes. A create link
-- is bound to the first email a trusted server reserves it for, or to the account that redeems it. A new household gets
-- one enabled profile with starter criteria equal to the collector bounds. Members can leave; the last active member
-- leaving archives the household, which is kept. Owners rename the household, make members owners, deactivate members
-- and manage pending join links. A household keeps an active owner while it has active members.

alter table hs.households add column archived_at timestamptz;

create table hs.invitations (
 id uuid primary key default gen_random_uuid(),
 purpose text not null check(purpose in ('create','join')),
 issued_by uuid not null references auth.users(id) on delete cascade,
 household_id uuid references hs.households(id),
 email text check(email is null or (email=lower(email) and length(email) between 3 and 254)),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 revoked_at timestamptz,
 redeemed_at timestamptz,
 redeemed_by uuid references auth.users(id) on delete set null,
 check((purpose='create' and household_id is null) or (purpose='join' and household_id is not null and email is not null))
);
alter table hs.invitations enable row level security;
revoke all on hs.invitations from public,anon,authenticated,service_role;

create function hs.token_hash(p_token text) returns text language sql immutable set search_path=pg_catalog as $$
 select encode(sha256(convert_to(p_token,'UTF8')),'hex');
$$;

-- The usable invitation for a token, locked, or null when it is unknown, expired, revoked, used, or its issuer or
-- household no longer allows it.
create function hs.live_invitation(p_token text) returns hs.invitations language plpgsql set search_path=pg_catalog,hs as $$
declare v hs.invitations;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null; end if;
 select * into v from hs.invitations where token_hash=hs.token_hash(p_token) for update;
 if v.id is null or v.revoked_at is not null or v.redeemed_at is not null or v.expires_at<=now() then return null; end if;
 if v.purpose='create' and not exists(select 1 from hs.members m join hs.households h on h.id=m.household_id where m.user_id=v.issued_by and m.active and h.archived_at is null) then return null; end if;
 if v.purpose='join' and not exists(select 1 from hs.members m join hs.households h on h.id=m.household_id where m.household_id=v.household_id and m.user_id=v.issued_by and m.active and m.role='owner' and h.archived_at is null) then return null; end if;
 return v;
end; $$;

create function hs.starter_criteria() returns jsonb language sql immutable set search_path=pg_catalog as $$
 select '{"minAreaM2":60,"maxAreaM2":null,"minRooms":1,"preferredPriceSek":5000000,"stretchPriceSek":6000000,"propertyTypes":["apartment"],"excludeGroundFloor":false,"requireLift":false,"requireOutdoor":false,"preferGlazing":false,"feeReferenceSek":6000,"geography":{"municipalities":["Göteborg"],"center":[11.9694,57.7067],"radiusKm":15},"nature":{"preferImmediateGreenery":false,"preferredWalkMinutes":10},"transit":{"preferredWalkMinutes":10,"preferredJourneyMinutes":30,"tradeoffJourneyMinutes":45}}'::jsonb;
$$;

-- A name typed by a person: trimmed, 1 to 80 characters, not blank.
create function hs.clean_name(p text) returns text language sql immutable set search_path=pg_catalog,hs as $$
 select case when p is not null and p ~ '\S' and hs.text_length(btrim(p)) between 1 and 80 then btrim(p) end;
$$;

-- Issues a link and returns its token once. Any active member may issue a create link; an active owner may issue a
-- join link for one email.
create function public.hs_invitation_create(p_purpose text,p_household_id uuid,p_email text) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare token text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''); v hs.invitations; address text:=lower(btrim(p_email));
begin
 if p_purpose='create' then
  perform hs.require_member(p_household_id);
  insert into hs.invitations(purpose,issued_by,token_hash) values('create',auth.uid(),hs.token_hash(token)) returning * into v;
 elsif p_purpose='join' then
  perform hs.require_member(p_household_id,true);
  if address is null or address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(address)>254 then raise exception 'Invalid email'; end if;
  perform 1 from hs.households where id=p_household_id for update;
  -- One pending join link per email and household: a new one replaces the old.
  update hs.invitations set revoked_at=now() where household_id=p_household_id and email=address and purpose='join' and redeemed_at is null and revoked_at is null;
  insert into hs.invitations(purpose,issued_by,household_id,email,token_hash) values('join',auth.uid(),p_household_id,address,hs.token_hash(token)) returning * into v;
 else raise exception 'Invalid invitation'; end if;
 return jsonb_build_object('id',v.id,'token',token,'expiresAt',v.expires_at);
end; $$;

-- What a link grants, for anyone holding it. The recipient email is not returned.
create function public.hs_invitation_preview(p_token text) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare v hs.invitations;
begin
 v:=hs.live_invitation(p_token);
 if v.id is null then return jsonb_build_object('valid',false); end if;
 return jsonb_build_object('valid',true,'purpose',v.purpose,'expiresAt',v.expires_at,
  'householdName',(select name from hs.households where id=v.household_id),
  'issuerName',(select display_name from hs.members where user_id=v.issued_by and active and (v.household_id is null or household_id=v.household_id) order by household_id limit 1));
end; $$;

-- Trusted server only: binds a create link to an email, or confirms a join link's email, before an Auth invitation is
-- sent. Returns ok false for anything else, so no account is created for an invalid link.
create function public.hs_invitation_reserve(p_token text,p_email text) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare v hs.invitations; address text:=lower(btrim(p_email));
begin
 v:=hs.live_invitation(p_token);
 if v.id is null or address is null or address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(address)>254 or (v.email is not null and v.email<>address) then return jsonb_build_object('ok',false); end if;
 if v.email is null then update hs.invitations set email=address where id=v.id; end if;
 return jsonb_build_object('ok',true,'purpose',v.purpose);
end; $$;

-- Accepts a link for the signed-in account. The account's confirmed email must match a bound link. A create link makes
-- a household, its owner and a starter profile; a join link adds a member or reactivates a former one.
create function public.hs_invitation_redeem(p_token text,p_household_name text,p_display_name text) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare v hs.invitations; me record; household uuid; display text:=hs.clean_name(p_display_name); existing hs.members;
begin
 select id,lower(email) email from auth.users where id=auth.uid() and email_confirmed_at is not null and email is not null into me;
 if me.id is null then raise exception 'Confirm your email before accepting' using errcode='42501'; end if;
 v:=hs.live_invitation(p_token);
 if v.id is null or (v.email is not null and v.email<>me.email) then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 if display is null then raise exception 'Invalid name'; end if;
 if v.purpose='create' then
  if hs.clean_name(p_household_name) is null then raise exception 'Invalid name'; end if;
  if (select count(*) from hs.members where user_id=me.id and active)>=10 then raise exception 'Membership limit reached'; end if;
  insert into hs.households(name) values(hs.clean_name(p_household_name)) returning id into household;
  insert into hs.members(household_id,user_id,display_name,role,active) values(household,me.id,display,'owner',true);
  insert into hs.profiles(household_id,name,enabled,criteria,edited_by) values(household,'Main profile',true,hs.starter_criteria(),me.id);
 else
  household:=v.household_id;
  perform 1 from hs.households where id=household for update;
  select * into existing from hs.members where household_id=household and user_id=me.id;
  if existing.user_id is not null and existing.active then raise exception 'Already a member'; end if;
  if existing.user_id is null then
   if (select count(*) from hs.members where household_id=household)>=10 then raise exception 'Household member limit reached'; end if;
   if (select count(*) from hs.members where user_id=me.id and active)>=10 then raise exception 'Membership limit reached'; end if;
   insert into hs.members(household_id,user_id,display_name,role,active) values(household,me.id,display,'member',true);
  else
   update hs.members set active=true,display_name=display where household_id=household and user_id=me.id;
  end if;
 end if;
 update hs.invitations set redeemed_at=now(),redeemed_by=me.id,email=coalesce(email,me.email) where id=v.id;
 return jsonb_build_object('householdId',household);
end; $$;

-- For Settings: the household name, every member with their state, and, for owners, pending join links.
create function public.hs_household_access(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hs as $$
declare is_owner boolean;
begin
 perform hs.require_member(p_household_id);
 is_owner:=exists(select 1 from hs.members where household_id=p_household_id and user_id=auth.uid() and active and role='owner');
 return jsonb_build_object(
  'name',(select name from hs.households where id=p_household_id),
  'members',(select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'displayName',display_name,'role',role,'active',active) order by active desc,display_name,user_id),'[]'::jsonb) from hs.members where household_id=p_household_id),
  'invitations',case when is_owner then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'createdAt',created_at,'expiresAt',expires_at) order by created_at),'[]'::jsonb)
   from hs.invitations where household_id=p_household_id and purpose='join' and redeemed_at is null and revoked_at is null and expires_at>now()) else '[]'::jsonb end);
end; $$;

create function public.hs_invitation_revoke(p_household_id uuid,p_invitation_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
begin
 perform hs.require_member(p_household_id,true);
 update hs.invitations set revoked_at=now() where id=p_invitation_id and household_id=p_household_id and redeemed_at is null and revoked_at is null;
 return jsonb_build_object('ok',true);
end; $$;

create function public.hs_household_rename(p_household_id uuid,p_name text) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
begin
 perform hs.require_member(p_household_id,true);
 if hs.clean_name(p_name) is null then raise exception 'Invalid name'; end if;
 update hs.households set name=hs.clean_name(p_name) where id=p_household_id;
 return jsonb_build_object('ok',true);
end; $$;

create function public.hs_member_make_owner(p_household_id uuid,p_user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
begin
 perform hs.require_member(p_household_id,true);
 perform 1 from hs.households where id=p_household_id for update;
 update hs.members set role='owner' where household_id=p_household_id and user_id=p_user_id and active;
 if not found then raise exception 'Member unavailable'; end if;
 return jsonb_build_object('ok',true);
end; $$;

-- An owner deactivates another member. The member's saves, notes and hides stay for a later return.
create function public.hs_member_deactivate(p_household_id uuid,p_user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
begin
 perform hs.require_member(p_household_id,true);
 perform 1 from hs.households where id=p_household_id for update;
 if p_user_id=auth.uid() then raise exception 'Use leave to remove yourself'; end if;
 update hs.members set active=false where household_id=p_household_id and user_id=p_user_id and active;
 if not found then raise exception 'Member unavailable'; end if;
 if not exists(select 1 from hs.members where household_id=p_household_id and role='owner' and active) then raise exception 'Household needs an active owner'; end if;
 return jsonb_build_object('ok',true);
end; $$;

-- The signed-in member leaves. The last active member archives the household; the last active owner with other active
-- members must make one of them an owner first.
create function public.hs_household_leave(p_household_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,hs as $$
declare others integer; owners integer;
begin
 perform hs.require_member(p_household_id);
 perform 1 from hs.households where id=p_household_id for update;
 select count(*) filter (where user_id<>auth.uid()),count(*) filter (where user_id<>auth.uid() and role='owner') into others,owners from hs.members where household_id=p_household_id and active;
 if others>0 and owners=0 and exists(select 1 from hs.members where household_id=p_household_id and user_id=auth.uid() and role='owner') then
  raise exception 'Make another member an owner before leaving' using errcode='P0002';
 end if;
 update hs.members set active=false where household_id=p_household_id and user_id=auth.uid();
 if others=0 then
  update hs.households set archived_at=now() where id=p_household_id;
  update hs.invitations set revoked_at=now() where household_id=p_household_id and redeemed_at is null and revoked_at is null;
 end if;
 return jsonb_build_object('archived',others=0);
end; $$;

-- Memberships carry the household name, so a person in several households can tell them apart.
create or replace function public.hs_memberships() returns jsonb language sql stable security definer set search_path=pg_catalog,hs as $$
 select coalesce(jsonb_agg(jsonb_build_object('householdId',m.household_id,'userId',m.user_id,'displayName',m.display_name,'role',m.role,'householdName',h.name) order by h.name,m.household_id),'[]'::jsonb)
 from hs.members m join hs.households h on h.id=m.household_id where m.user_id=auth.uid() and m.active and h.archived_at is null;
$$;

revoke all on all functions in schema hs from public,anon,authenticated,service_role;
revoke all on function public.hs_invitation_create(text,uuid,text),public.hs_invitation_preview(text),public.hs_invitation_reserve(text,text),public.hs_invitation_redeem(text,text,text),
 public.hs_household_access(uuid),public.hs_invitation_revoke(uuid,uuid),public.hs_household_rename(uuid,text),public.hs_member_make_owner(uuid,uuid),public.hs_member_deactivate(uuid,uuid),public.hs_household_leave(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.hs_invitation_create(text,uuid,text),public.hs_invitation_redeem(text,text,text),public.hs_household_access(uuid),public.hs_invitation_revoke(uuid,uuid),
 public.hs_household_rename(uuid,text),public.hs_member_make_owner(uuid,uuid),public.hs_member_deactivate(uuid,uuid),public.hs_household_leave(uuid) to authenticated;
grant execute on function public.hs_invitation_preview(text) to anon,authenticated;
grant execute on function public.hs_invitation_reserve(text,text) to service_role;
