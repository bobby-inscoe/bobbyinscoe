-- Basket runs in its own Supabase project; do not apply to Shellter.
create schema bk;
revoke all on schema bk from public, anon, authenticated;
grant usage on schema bk to authenticated;

create table bk.baskets (
  id uuid primary key,
  title text not null check (length(btrim(title)) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  archived boolean not null default false,
  revision integer not null default 1 check (revision > 0)
);
create table bk.members (
  basket_id uuid not null references bk.baskets(id),
  user_id uuid not null references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 60),
  role text not null check (role in ('owner', 'member')),
  active boolean not null default true,
  primary key (basket_id, user_id)
);
create index members_user on bk.members(user_id, basket_id) where active;
create table bk.kits (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  title text not null check (length(btrim(title)) between 1 and 80),
  revision integer not null default 1,
  created_at timestamptz not null default now()
);
create index kits_user on bk.kits(user_id);
create table bk.kit_items (
  id uuid primary key,
  kit_id uuid not null references bk.kits(id) on delete cascade,
  text text not null check (length(btrim(text)) between 1 and 240),
  position integer not null check (position >= 0)
);
create index kit_items_kit on bk.kit_items(kit_id);
create table bk.saved_kits (
  id uuid primary key,
  basket_id uuid not null references bk.baskets(id),
  source_id uuid references bk.kits(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 80),
  position integer not null check (position >= 0),
  unique (basket_id, source_id),
  unique (basket_id, id)
);
create table bk.saved_items (
  id uuid primary key,
  basket_id uuid not null,
  kit_id uuid not null,
  text text not null check (length(btrim(text)) between 1 and 240),
  position integer not null check (position >= 0),
  foreign key (basket_id, kit_id) references bk.saved_kits(basket_id, id),
  unique (basket_id, id)
);
create index saved_items_kit on bk.saved_items(kit_id);
create table bk.items (
  id uuid primary key,
  basket_id uuid not null references bk.baskets(id),
  text text not null check (length(btrim(text)) between 1 and 240),
  position integer not null check (position >= 0),
  source_id uuid,
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  revision integer not null default 1,
  foreign key (basket_id, source_id) references bk.saved_items(basket_id, id),
  check ((completed_at is null) = (completed_by is null))
);
create index items_basket on bk.items(basket_id);
create table bk.links (
  id uuid primary key,
  basket_id uuid not null references bk.baskets(id),
  issued_by uuid not null references auth.users(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index one_live_link on bk.links(basket_id) where active;
create table bk.receipts (
  user_id uuid not null references auth.users(id),
  id uuid not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table bk.handovers (
  user_id uuid primary key references auth.users(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  redeemed_by uuid references auth.users(id)
);
create table bk.retired_identities (
  user_id uuid primary key references auth.users(id)
);

-- Only revisions are published; checklist contents always require a fresh authorized read.
create table public.basket_signals (
  basket_id uuid primary key references bk.baskets(id),
  revision integer not null
);
alter table public.basket_signals enable row level security;
revoke all on public.basket_signals from public, anon, authenticated;
grant select on public.basket_signals to authenticated;
do $$ declare t text; begin
  foreach t in array array['baskets','members','kits','kit_items','saved_kits','saved_items','items','links','receipts','handovers','retired_identities'] loop
    execute format('alter table bk.%I enable row level security', t);
    execute format('revoke all on bk.%I from public, anon, authenticated', t);
  end loop;
end $$;

create function bk.actor() returns uuid language plpgsql stable set search_path = '' as $$
declare me uuid := auth.uid(); begin
  if me is null or not exists (select 1 from auth.users where id = me)
    or exists (select 1 from bk.retired_identities where user_id = me) then
    raise exception 'Your session is no longer available. Please reconnect.' using errcode = '42501';
  end if;
  return me;
end $$;

create function bk.can_read(p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and not exists (select 1 from bk.retired_identities where user_id = auth.uid())
    and exists (select 1 from bk.members where basket_id = p_id and user_id = auth.uid() and active)
$$;
create policy basket_signals_members on public.basket_signals for select to authenticated using (bk.can_read(basket_id));

create function bk.require_basket(p_id uuid, p_owner boolean, p_writable boolean)
returns bk.baskets language plpgsql set search_path = '' as $$
declare b bk.baskets; r text; begin
  select * into b from bk.baskets where id = p_id for update;
  select role into r from bk.members where basket_id = p_id and user_id = bk.actor() and active;
  if b.id is null or r is null or (p_owner and r <> 'owner') then
    raise exception 'You do not have access to this basket action.' using errcode = '42501';
  end if;
  if p_writable and b.archived then raise exception 'Restore this basket before changing it.'; end if;
  return b;
end $$;

create function bk.check_definition(p_title text, p_items jsonb) returns void language plpgsql set search_path = '' as $$
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 80
    or p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Enter a kit name and its items.'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'A kit needs between 1 and 100 items.'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) v where
    jsonb_typeof(v) <> 'object' or coalesce(v->>'text','') = '' or length(btrim(v->>'text')) not between 1 and 240
    or coalesce(v->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    or (select count(distinct v->>'id') from jsonb_array_elements(p_items) v) <> jsonb_array_length(p_items)
  then raise exception 'Each kit item needs its own ID and 1 to 240 characters.'; end if;
end $$;

create function bk.snapshot(p_basket uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := bk.actor(); selected jsonb := null; begin
  if p_basket is not null then
    if not bk.can_read(p_basket) then raise exception 'This basket is no longer available to you.' using errcode = '42501'; end if;
    select jsonb_build_object(
      'id', b.id, 'title', b.title, 'revision', b.revision, 'archived', b.archived,
      'role', (select role from bk.members where basket_id = b.id and user_id = me),
      'members', coalesce((select jsonb_agg(jsonb_build_object('id', user_id, 'name', name, 'role', role) order by name, user_id) from bk.members where basket_id = b.id and active), '[]'::jsonb),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'text', text, 'revision', revision, 'completed', completed_at is not null, 'sourceId', source_id) order by position, id) from bk.items where basket_id = b.id), '[]'::jsonb),
      'savedKits', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'text', i.text) order by i.position, i.id) from bk.saved_items i where i.kit_id = k.id), '[]'::jsonb)) order by k.position, k.id) from bk.saved_kits k where k.basket_id = b.id), '[]'::jsonb),
      'linkId', (select l.id from bk.links l join bk.members m on m.basket_id = l.basket_id and m.user_id = l.issued_by where l.basket_id = b.id and l.active and m.active and m.role = 'owner')
    ) into selected from bk.baskets b where b.id = p_basket;
  end if;
  return jsonb_build_object('userId', me,
    'baskets', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'archived', b.archived, 'role', m.role, 'revision', b.revision,
      'peopleCount', (select count(*) from bk.members x where x.basket_id = b.id and x.active)) order by b.created_at desc, b.id)
      from bk.baskets b join bk.members m on m.basket_id = b.id where m.user_id = me and m.active), '[]'::jsonb),
    'kits', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'revision', k.revision,
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'text', i.text) order by i.position, i.id) from bk.kit_items i where i.kit_id = k.id), '[]'::jsonb)) order by k.created_at, k.id)
      from bk.kits k where k.user_id = me), '[]'::jsonb), 'basket', selected);
end $$;

create function bk.command(p_request uuid, p_action jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := bk.actor(); op text := p_action->>'type'; bid uuid := (p_action->>'basketId')::uuid;
  obj uuid := (p_action->>'id')::uuid; target uuid; src uuid; b bk.baskets; k bk.kits; h bk.handovers;
  previous bk.receipts; result jsonb := '{}'::jsonb; v jsonb; ord bigint; offset_pos integer;
  r text; n integer; hash text := encode(sha256(convert_to(p_action::text, 'UTF8')), 'hex');
  touch_basket boolean := false;
begin
  if p_request is null or p_action is null or jsonb_typeof(p_action) <> 'object' then raise exception 'Invalid request.'; end if;
  -- Serializing each actor also makes retry receipts and private kit revisions atomic.
  perform pg_advisory_xact_lock(hashtextextended(me::text, 0));
  perform bk.actor();
  select * into previous from bk.receipts where user_id = me and id = p_request;
  if found then
    if previous.request_hash <> hash then raise exception 'This request ID was already used for another change.'; end if;
    return previous.result;
  end if;
  if (select count(*) from bk.receipts where user_id = me and created_at > now() - interval '1 minute') >= 120 then
    raise exception 'Too many changes. Please wait a minute.';
  end if;

  if op = 'create' then
    if (select count(*) from bk.members where user_id = me and active) >= 50 then raise exception 'You can join up to 50 baskets.'; end if;
    insert into bk.baskets(id, title, created_by) values(obj, btrim(p_action->>'title'), me);
    insert into bk.members values(obj, me, btrim(p_action->>'name'), 'owner', true);
    insert into public.basket_signals values(obj, 1);
    result := jsonb_build_object('id', obj);
  elsif op = 'join' then
    if coalesce(p_action->>'token','') !~ '^[a-f0-9]{64}$' then raise exception 'This join link is not available.'; end if;
    select basket_id into bid from bk.links where token_hash = encode(sha256(convert_to(p_action->>'token','UTF8')),'hex') and active;
    select * into b from bk.baskets where id = bid for update;
    if b.id is null or b.archived or not exists(select 1 from bk.links l join bk.members m on m.basket_id=l.basket_id and m.user_id=l.issued_by
      where l.basket_id=bid and l.token_hash=encode(sha256(convert_to(p_action->>'token','UTF8')),'hex') and l.active and m.active and m.role='owner') then
      raise exception 'This join link is not available.';
    end if;
    if exists(select 1 from bk.members where basket_id=bid and user_id=me and not active) then raise exception 'An owner needs to invite you back.' using errcode='42501'; end if;
    if not exists(select 1 from bk.members where basket_id=bid and user_id=me) then
      if (select count(*) from bk.members where user_id=me and active)>=50 or (select count(*) from bk.members where basket_id=bid and active)>=100 then raise exception 'This basket or your basket collection is full.'; end if;
      insert into bk.members values(bid,me,btrim(p_action->>'name'),'member',true);
    end if;
    result := jsonb_build_object('id',bid);
    touch_basket := true;
  elsif op in ('kit_save','kit_delete') then
    select * into k from bk.kits where id=obj for update;
    if k.id is not null and k.user_id<>me then raise exception 'Kit access denied.' using errcode='42501'; end if;
    if k.id is not null and k.revision is distinct from (p_action->>'revision')::integer then raise exception 'This kit changed. Reload before saving.' using errcode='40001'; end if;
    if op='kit_delete' then
      if k.id is null then raise exception 'This kit is no longer available.'; end if;
      delete from bk.kits where id=obj;
    else
      perform bk.check_definition(p_action->>'title',p_action->'items');
      if k.id is null then
        if (select count(*) from bk.kits where user_id=me)>=100 then raise exception 'You can save up to 100 personal kits.'; end if;
        insert into bk.kits(id,user_id,title) values(obj,me,btrim(p_action->>'title'));
      else update bk.kits set title=btrim(p_action->>'title'),revision=revision+1 where id=obj; end if;
      -- IDs may only belong to this kit, including when a malicious request reuses an ID.
      delete from bk.kit_items where kit_id=obj and id not in(select (x->>'id')::uuid from jsonb_array_elements(p_action->'items') x);
      for v,ord in select value,ordinality from jsonb_array_elements(p_action->'items') with ordinality loop
        if exists(select 1 from bk.kit_items where id=(v->>'id')::uuid and kit_id<>obj) then raise exception 'Item belongs to another kit.'; end if;
        insert into bk.kit_items values((v->>'id')::uuid,obj,btrim(v->>'text'),ord::integer)
          on conflict(id) do update set text=excluded.text,position=excluded.position where bk.kit_items.kit_id=excluded.kit_id;
        if not found then raise exception 'Item belongs to another kit.'; end if;
      end loop;
    end if;
    result:=jsonb_build_object('id',obj);
  elsif op='handover_prepare' then
    if not exists(select 1 from auth.users u where u.id=me and u.is_anonymous) then raise exception 'Only a guest session needs a handover.'; end if;
    if coalesce(p_action->>'token','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid handover credential.'; end if;
    insert into bk.handovers values(me,encode(sha256(convert_to(p_action->>'token','UTF8')),'hex'),now()+interval '15 minutes',null)
      on conflict(user_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at,redeemed_by=null;
  elsif op='handover_finish' then
    if not exists(select 1 from auth.users u where u.id=me and u.email_confirmed_at is not null and not u.is_anonymous) then raise exception 'Verify your account before keeping guest access.' using errcode='42501'; end if;
    select user_id into src from bk.handovers where token_hash=encode(sha256(convert_to(p_action->>'token','UTF8')),'hex');
    if src is null or src=me then raise exception 'This handover has expired or was already used.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(src::text,0));
    if not exists(select 1 from auth.users where id=src and is_anonymous) then raise exception 'This guest has already become an account. Sign in to that account instead.'; end if;
    select * into h from bk.handovers where user_id=src and token_hash=encode(sha256(convert_to(p_action->>'token','UTF8')),'hex') for update;
    if h.user_id is null or h.expires_at<now() or h.redeemed_by is not null then raise exception 'This handover has expired or was already used.'; end if;
    for bid in select basket_id from bk.members where user_id=src and active order by basket_id loop
      perform 1 from bk.baskets where id=bid for update;
      insert into bk.members(basket_id,user_id,name,role,active)
        select basket_id,me,name,role,true from bk.members where basket_id=bid and user_id=src
        on conflict(basket_id,user_id) do update set role=case when bk.members.role='owner' or excluded.role='owner' then 'owner' else 'member' end,active=true;
      update bk.members set active=false where basket_id=bid and user_id=src;
      update bk.links set issued_by=me where basket_id=bid and issued_by=src;
      update bk.baskets set revision=revision+1 where id=bid;
      update public.basket_signals set revision=revision+1 where basket_id=bid;
    end loop;
    update bk.kits set user_id=me where user_id=src;
    update bk.handovers set redeemed_by=me where user_id=src;
    insert into bk.retired_identities values(src);
    bid:=null;
  else
    if op is null or op not in ('rename','archive','item_add','item_edit','item_check','item_remove','kit_attach','saved_edit','saved_remove','reset','link_set','person','leave') then raise exception 'Unknown basket action.'; end if;
    b:=bk.require_basket(bid,op not in ('item_add','item_edit','item_check','item_remove','leave'),op<>'archive' and op<>'leave');
    touch_basket := true;
    if op in ('rename','archive','saved_edit','saved_remove','reset','person') and b.revision is distinct from (p_action->>'revision')::integer then
      raise exception 'This basket changed. Review it again before continuing.' using errcode='40001';
    end if;
    if op='rename' then update bk.baskets set title=btrim(p_action->>'title') where id=bid;
    elsif op='archive' then update bk.baskets set archived=(p_action->>'archived')::boolean where id=bid;
    elsif op='item_add' then
      if (select count(*) from bk.items where basket_id=bid)>=1000 then raise exception 'A basket can hold up to 1,000 items.'; end if;
      select coalesce(max(position),0)+1 into offset_pos from bk.items where basket_id=bid;
      insert into bk.items(id,basket_id,text,position) values(obj,bid,btrim(p_action->>'text'),offset_pos);
    elsif op in ('item_edit','item_check','item_remove') then
      if not exists(select 1 from bk.items where id=obj and basket_id=bid) then raise exception 'This item was removed. Reload your basket.' using errcode='40001'; end if;
      if op in ('item_edit','item_remove') and not exists(select 1 from bk.items where id=obj and basket_id=bid and revision=(p_action->>'revision')::integer) then raise exception 'This item changed. Reload before editing it.' using errcode='40001'; end if;
      if op='item_edit' then update bk.items set text=btrim(p_action->>'text'),revision=revision+1 where id=obj and basket_id=bid;
      elsif op='item_remove' then delete from bk.items where id=obj and basket_id=bid;
      else
        if jsonb_typeof(p_action->'completed') is distinct from 'boolean' then raise exception 'Choose a completion state.'; end if;
        update bk.items set completed_at=case when (p_action->>'completed')::boolean then coalesce(completed_at,now()) else null end,
          completed_by=case when (p_action->>'completed')::boolean then coalesce(completed_by,me) else null end,revision=revision+1 where id=obj and basket_id=bid;
      end if;
    elsif op='kit_attach' then
      select * into k from bk.kits where id=(p_action->>'kitId')::uuid and user_id=me;
      if k.id is null then raise exception 'Kit access denied.' using errcode='42501'; end if;
      if exists(select 1 from bk.saved_kits where basket_id=bid and source_id=k.id) then raise exception 'This kit is already saved to the basket.'; end if;
      if (select count(*) from bk.saved_kits where basket_id=bid)>=10 then raise exception 'Save up to 10 kits per basket.'; end if;
      if (select count(*) from bk.items where basket_id=bid)+(select count(*) from bk.kit_items where kit_id=k.id)>1000 then raise exception 'A basket can hold up to 1,000 items.'; end if;
      select coalesce(max(position),0)+1 into offset_pos from bk.saved_kits where basket_id=bid;
      insert into bk.saved_kits values(obj,bid,k.id,k.title,offset_pos);
      insert into bk.saved_items select gen_random_uuid(),bid,obj,text,position from bk.kit_items where kit_id=k.id;
      select coalesce(max(position),0)+1 into offset_pos from bk.items where basket_id=bid;
      insert into bk.items(id,basket_id,text,position,source_id)
        select gen_random_uuid(),bid,i.text,offset_pos+row_number() over(order by i.position,i.id)::integer,i.id from bk.saved_items i where i.kit_id=obj;
    elsif op in ('saved_edit','saved_remove') then
      if not exists(select 1 from bk.saved_kits where id=obj and basket_id=bid) then raise exception 'This saved kit is no longer available.'; end if;
      if op='saved_remove' then
        update bk.items set source_id=null where basket_id=bid and source_id in(select id from bk.saved_items where kit_id=obj);
        delete from bk.saved_items where kit_id=obj;
        delete from bk.saved_kits where id=obj;
      else
        perform bk.check_definition(p_action->>'title',p_action->'items');
        update bk.saved_kits set title=btrim(p_action->>'title') where id=obj;
        update bk.items set source_id=null where basket_id=bid and source_id in(select id from bk.saved_items where kit_id=obj and id not in(select (x->>'id')::uuid from jsonb_array_elements(p_action->'items') x));
        delete from bk.saved_items where kit_id=obj and id not in(select (x->>'id')::uuid from jsonb_array_elements(p_action->'items') x);
        for v,ord in select value,ordinality from jsonb_array_elements(p_action->'items') with ordinality loop
          if exists(select 1 from bk.saved_items where id=(v->>'id')::uuid and kit_id<>obj) then raise exception 'Item belongs to another saved kit.'; end if;
          insert into bk.saved_items values((v->>'id')::uuid,bid,obj,btrim(v->>'text'),ord::integer)
            on conflict(id) do update set text=excluded.text,position=excluded.position where bk.saved_items.kit_id=excluded.kit_id and bk.saved_items.basket_id=excluded.basket_id;
          if not found then raise exception 'Item belongs to another saved kit.'; end if;
        end loop;
      end if;
    elsif op='reset' then
      if not exists(select 1 from bk.saved_kits where basket_id=bid) then raise exception 'Save a kit before resetting this basket.'; end if;
      delete from bk.items where basket_id=bid;
      insert into bk.items(id,basket_id,text,position,source_id)
        select gen_random_uuid(),bid,i.text,row_number() over(order by sk.position,sk.id,i.position,i.id)::integer,i.id
        from bk.saved_items i join bk.saved_kits sk on sk.id=i.kit_id where i.basket_id=bid;
    elsif op='link_set' then
      update bk.links set active=false where basket_id=bid and active;
      if p_action->>'token' is not null then
        if p_action->>'token' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid join link.'; end if;
        insert into bk.links(id,basket_id,issued_by,token_hash) values(obj,bid,me,encode(sha256(convert_to(p_action->>'token','UTF8')),'hex'));
      end if;
    elsif op='person' then
      target:=obj;
      if target=me then raise exception 'Ask another owner to change your role.'; end if;
      select role into r from bk.members where basket_id=bid and user_id=target and active;
      if r is null then raise exception 'This person is no longer in the basket.'; end if;
      if coalesce(p_action->>'role','') not in ('owner','member','removed') then raise exception 'Choose an owner or member role.'; end if;
      select count(*) into n from bk.members where basket_id=bid and role='owner' and active;
      if r='owner' and p_action->>'role'<>'owner' and n<=1 then raise exception 'Keep at least one owner.'; end if;
      update bk.members set role=case when p_action->>'role'='owner' then 'owner' else 'member' end,active=p_action->>'role'<>'removed' where basket_id=bid and user_id=target;
      if p_action->>'role'<>'owner' then update bk.links set active=false where basket_id=bid and issued_by=target; end if;
    elsif op='leave' then
      if exists(select 1 from bk.members where basket_id=bid and user_id=me and role='owner') then raise exception 'Owners can archive this basket instead.'; end if;
      update bk.members set active=false where basket_id=bid and user_id=me;
    end if;
  end if;

  if touch_basket then
    update bk.baskets set revision=revision+1 where id=bid;
    update public.basket_signals set revision=revision+1 where basket_id=bid;
  end if;
  insert into bk.receipts(user_id,id,request_hash,result) values(me,p_request,hash,result);
  -- Retry receipts last seven days; the browser never queues durable offline writes.
  delete from bk.receipts where user_id=me and created_at<now()-interval '7 days';
  return result;
end $$;

create function public.basket_snapshot(p_basket uuid default null) returns jsonb language sql security invoker set search_path = '' as $$ select bk.snapshot(p_basket) $$;
create function public.basket_command(p_request uuid, p_action jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select bk.command(p_request,p_action) $$;
revoke all on all functions in schema bk from public, anon, authenticated;
grant execute on function bk.can_read(uuid), bk.snapshot(uuid), bk.command(uuid,jsonb) to authenticated;
revoke all on function public.basket_snapshot(uuid), public.basket_command(uuid,jsonb) from public, anon;
grant execute on function public.basket_snapshot(uuid), public.basket_command(uuid,jsonb) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.basket_signals;
  end if;
end $$;
