-- V1: заказы и этапы. Оплаты можно привязать к заказу.

create or replace function public._valid_stages(p text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(array_length(p, 1), 0) between 2 and 8
     and not exists (select 1 from unnest(p) s where length(btrim(coalesce(s, ''))) not between 1 and 32)
$$;

alter table public.artists
  add column order_stages text[] not null default array['Очередь', 'Скетч', 'Покраска', 'Готово']
  check (public._valid_stages(order_stages));

create table public.orders (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references public.artists,
  program_id  uuid not null references public.programs,
  user_id     uuid not null references public.users,
  title       text not null check (length(title) between 1 and 80),
  price       bigint check (price is null or price between 0 and 10000000),
  stages      text[] not null check (public._valid_stages(stages)),
  stage       int not null default 0,
  status      text not null default 'active' check (status in ('active', 'done', 'cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz,
  check (stage >= 0 and stage < array_length(stages, 1))
);
create index orders_artist_idx on public.orders (artist_id, status, updated_at desc);
create index orders_user_idx on public.orders (user_id, status, updated_at desc);

create table public.order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders on delete cascade,
  kind        text not null check (kind in ('created', 'stage', 'done', 'reopened', 'cancelled')),
  stage       int,
  stage_name  text,
  created_at  timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

alter table public.ledger_entries add column order_id uuid references public.orders;
create index ledger_order_idx on public.ledger_entries (order_id) where order_id is not null;

alter table public.orders       enable row level security;
alter table public.order_events enable row level security;

-------------------------------------------------------------------------------
-- Помощники
-------------------------------------------------------------------------------

create or replace function public._clean_stages(p text[])
returns text[] language sql immutable set search_path = public as $$
  select array_agg(btrim(s) order by n) from unnest(p) with ordinality as t(s, n)
$$;

create or replace function public._order_json(o public.orders)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'title', o.title, 'price', o.price, 'stages', to_jsonb(o.stages),
    'stage', o.stage, 'stage_name', o.stages[o.stage + 1], 'status', o.status,
    'created_at', o.created_at, 'updated_at', o.updated_at, 'done_at', o.done_at,
    'paid', (select coalesce(sum(e.paid_amount), 0) from ledger_entries e
             where e.order_id = o.id and e.kind in ('accrual', 'redeem') and not _is_reversed(e.id)),
    'redeemed', (select coalesce(sum(e.redeemed), 0) from ledger_entries e
                 where e.order_id = o.id and e.kind in ('accrual', 'redeem') and not _is_reversed(e.id)),
    'artist', (select jsonb_build_object('id', a.id, 'nick', a.nick, 'color', a.color, 'display_name', a.display_name)
               from artists a where a.id = o.artist_id),
    'member', (select jsonb_build_object('name', u.first_name, 'code', u.member_code)
               from users u where u.id = o.user_id))
$$;

create or replace function public._artist_order(p_artist_user uuid, p_order uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  o orders;
begin
  select * into o from orders where id = p_order and artist_id = a.id for update;
  if not found then perform _fail('Заказ не найден'); end if;
  return o;
end $$;

create or replace function public._member_tg(p_user uuid)
returns bigint language sql stable set search_path = public as $$
  select telegram_id from users where id = p_user
$$;

-------------------------------------------------------------------------------
-- Заказы
-------------------------------------------------------------------------------

create or replace function public.create_order(p_artist_user uuid, p_member_code text, p_title text, p_price bigint, p_stages text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  m users := find_member(p_member_code);
  v_stages text[];
  o orders;
begin
  if m.id = a.user_id then perform _fail('Нельзя создать заказ самому себе'); end if;
  if not exists (select 1 from memberships where program_id = a.program_id and user_id = m.id) then
    perform _fail(format('%s ещё не в вашей программе. Попросите клиента вступить по ссылке.', m.first_name));
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 80 then
    perform _fail('Название заказа — от 1 до 80 символов');
  end if;
  if p_price is not null and (p_price < 0 or p_price > 10000000) then perform _fail('Некорректная цена'); end if;
  v_stages := coalesce(nullif(_clean_stages(p_stages), '{}'), a.order_stages);
  if not _valid_stages(v_stages) then perform _fail('Этапов должно быть от 2 до 8, у каждого — название до 32 символов'); end if;

  insert into orders (artist_id, program_id, user_id, title, price, stages)
  values (a.id, a.program_id, m.id, btrim(p_title), p_price, v_stages)
  returning * into o;
  insert into order_events (order_id, kind, stage, stage_name) values (o.id, 'created', 0, v_stages[1]);
  return _order_json(o) || jsonb_build_object('member_telegram_id', m.telegram_id);
end $$;

create or replace function public.set_order_stage(p_artist_user uuid, p_order uuid, p_stage int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o orders := _artist_order(p_artist_user, p_order);
  v_last int := array_length(o.stages, 1) - 1;
  v_kind text;
begin
  if o.status = 'cancelled' then perform _fail('Заказ отменён'); end if;
  if p_stage is null or p_stage < 0 or p_stage > v_last then perform _fail('Нет такого этапа'); end if;
  if p_stage = o.stage then
    return _order_json(o) || jsonb_build_object('member_telegram_id', _member_tg(o.user_id), 'event', null);
  end if;
  v_kind := case when p_stage = v_last then 'done' when o.status = 'done' then 'reopened' else 'stage' end;

  update orders set stage = p_stage,
                    status = case when p_stage = v_last then 'done' else 'active' end,
                    done_at = case when p_stage = v_last then now() end,
                    updated_at = now()
   where id = o.id returning * into o;
  insert into order_events (order_id, kind, stage, stage_name) values (o.id, v_kind, p_stage, o.stages[p_stage + 1]);
  return _order_json(o) || jsonb_build_object('member_telegram_id', _member_tg(o.user_id), 'event', v_kind);
end $$;

create or replace function public.cancel_order(p_artist_user uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o orders := _artist_order(p_artist_user, p_order);
begin
  if o.status = 'cancelled' then perform _fail('Заказ уже отменён'); end if;
  update orders set status = 'cancelled', updated_at = now() where id = o.id returning * into o;
  insert into order_events (order_id, kind, stage, stage_name) values (o.id, 'cancelled', o.stage, o.stages[o.stage + 1]);
  return _order_json(o) || jsonb_build_object('member_telegram_id', _member_tg(o.user_id));
end $$;

create or replace function public.artist_orders(p_artist_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  return coalesce((
    select jsonb_agg(_order_json(o) order by (o.status = 'active') desc, o.updated_at desc)
    from orders o
    where o.id in (select id from orders where artist_id = a.id order by (status = 'active') desc, updated_at desc limit 200)
  ), '[]'::jsonb);
end $$;

create or replace function public.member_orders(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(_order_json(o) order by (o.status = 'active') desc, o.updated_at desc)
    from orders o
    where o.id in (select id from orders where user_id = p_user and status <> 'cancelled'
                   order by (status = 'active') desc, updated_at desc limit 200)
  ), '[]'::jsonb)
$$;

create or replace function public.get_order(p_user uuid, p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o orders;
  v_artist_user uuid;
begin
  select * into o from orders where id = p_order;
  if not found then perform _fail('Заказ не найден'); end if;
  select user_id into v_artist_user from artists where id = o.artist_id;
  if p_user <> o.user_id and p_user <> v_artist_user then perform _fail('Заказ не найден'); end if;
  return _order_json(o) || jsonb_build_object(
    'is_artist', p_user = v_artist_user,
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', ev.kind, 'stage', ev.stage, 'stage_name', ev.stage_name,
                                                            'created_at', ev.created_at) order by ev.created_at)
                        from order_events ev where ev.order_id = o.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(_entry_json(e) order by e.created_at desc)
                          from ledger_entries e where e.order_id = o.id and e.kind in ('accrual', 'redeem')), '[]'::jsonb));
end $$;

-------------------------------------------------------------------------------
-- Начисление/списание с привязкой к заказу
-------------------------------------------------------------------------------

drop function public.quote_operation(uuid, text, text, bigint, bigint);
drop function public.commit_operation(uuid, text, text, bigint, bigint);
drop function public._operation(uuid, uuid, text, bigint, bigint, boolean, text, uuid);

create function public._operation(
  p_artist uuid, p_member uuid, p_mode text, p_amount bigint, p_redeem bigint,
  p_commit boolean, p_source text, p_actor uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists;
  m users;
  p programs;
  o orders;
  t tiers;
  nt tiers;
  v_spent bigint;
  v_bal bigint;
  v_pay_limit bigint := 0;
  v_foreign_cap bigint;
  v_own bigint := 0;
  v_foreign bigint := 0;
  v_max bigint := 0;
  v_r bigint := 0;
  v_paid bigint;
  v_earn bigint;
  v_entry uuid;
  v_need bigint;
  v_foreign_used bigint := 0;
  v_take bigint;
  lot record;
  result jsonb;
begin
  if p_mode not in ('earn', 'redeem') then perform _fail('Неизвестный тип операции'); end if;
  if p_amount is null or p_amount <= 0 then perform _fail('Сумма должна быть больше нуля'); end if;
  if p_amount > 10000000 then perform _fail('Слишком большая сумма'); end if;
  if p_redeem is not null and p_redeem < 0 then perform _fail('Количество АРТов не может быть отрицательным'); end if;

  select * into a from artists where id = p_artist and active;
  if not found then perform _fail('Художник не найден'); end if;
  select * into m from users where id = p_member;
  if not found then perform _fail('Участник не найден'); end if;
  if m.id = a.user_id then perform _fail('Нельзя начислять АРТы самому себе'); end if;
  select * into p from programs where id = a.program_id;
  if not exists (select 1 from memberships where program_id = a.program_id and user_id = m.id) then
    perform _fail(format('%s ещё не в программе «%s»', m.first_name, p.name));
  end if;
  if p_order is not null then
    select * into o from orders where id = p_order and artist_id = a.id and user_id = m.id and status <> 'cancelled';
    if not found then perform _fail('Этот заказ не найден у клиента'); end if;
  end if;

  if p_commit then
    perform pg_advisory_xact_lock(hashtextextended(a.program_id::text || m.id::text, 0));
  end if;

  v_spent := _spent(m.id, a.id);
  t := _tier_for(a.id, v_spent);
  v_bal := _balance(m.id, a.program_id);

  if p_mode = 'redeem' then
    v_pay_limit := floor(p_amount * t.pay_pct / 100);
    select coalesce(sum(remaining) filter (where origin_artist_id is null or origin_artist_id = a.id), 0),
           coalesce(sum(remaining) filter (where origin_artist_id is not null and origin_artist_id <> a.id), 0)
      into v_own, v_foreign
      from point_lots
     where user_id = m.id and program_id = a.program_id and remaining > 0
       and (expires_at is null or expires_at > now());
    if a.foreign_mode = 'by_tier' then
      v_foreign_cap := floor(p_amount * t.foreign_pct / 100);
    else
      v_foreign_cap := v_foreign;
    end if;
    v_max := least(v_pay_limit, v_own + least(v_foreign, v_foreign_cap));
    v_r := coalesce(least(p_redeem, v_max), v_max);
  end if;

  v_paid := p_amount - v_r;
  v_earn := floor(v_paid * t.earn_pct / 100);
  nt := _tier_for(a.id, v_spent + v_paid);

  result := jsonb_build_object(
    'mode', p_mode, 'amount', p_amount, 'redeem', v_r, 'max_redeem', v_max,
    'pay_limit', v_pay_limit,
    'foreign_cap', case when a.foreign_mode = 'by_tier' then v_foreign_cap end,
    'foreign_available', v_foreign, 'own_available', v_own,
    'paid', v_paid, 'earn', v_earn, 'points', v_earn - v_r,
    'balance_before', v_bal, 'balance_after', v_bal + v_earn - v_r,
    'spent_before', v_spent, 'spent_after', v_spent + v_paid,
    'tier', jsonb_build_object('index', t.sort, 'name', t.name, 'earn_pct', t.earn_pct, 'pay_pct', t.pay_pct, 'foreign_pct', t.foreign_pct),
    'new_tier', jsonb_build_object('index', nt.sort, 'name', nt.name, 'earn_pct', nt.earn_pct, 'pay_pct', nt.pay_pct),
    'tier_up', nt.sort > t.sort,
    'member', jsonb_build_object('id', m.id, 'name', m.first_name, 'code', m.member_code, 'telegram_id', m.telegram_id),
    'artist', jsonb_build_object('id', a.id, 'nick', a.nick),
    'program', jsonb_build_object('id', p.id, 'name', p.name, 'type', p.type),
    'order', case when o.id is not null then jsonb_build_object('id', o.id, 'title', o.title) end);

  if not p_commit then return result; end if;

  if p_redeem is not null and p_redeem > v_max then
    perform _fail(format('Можно списать не больше %s АРТ', v_max));
  end if;
  if p_mode = 'redeem' and v_r <= 0 then perform _fail('Нечего списать'); end if;

  insert into ledger_entries (program_id, user_id, artist_id, kind, order_amount, paid_amount, earned, redeemed, points,
                              tier_snapshot, source, created_by, order_id)
  values (a.program_id, m.id, a.id, case p_mode when 'earn' then 'accrual' else 'redeem' end,
          p_amount, v_paid, v_earn, v_r, v_earn - v_r, result -> 'tier', coalesce(p_source, 'cassa'), p_actor, o.id)
  returning id into v_entry;

  if v_r > 0 then
    v_need := v_r;
    for lot in
      select * from point_lots
       where user_id = m.id and program_id = a.program_id and remaining > 0
         and (expires_at is null or expires_at > now())
       order by (expires_at is null), expires_at,
                (origin_artist_id is not null and origin_artist_id <> a.id), created_at
       for update
    loop
      exit when v_need <= 0;
      v_take := least(lot.remaining, v_need);
      if lot.origin_artist_id is not null and lot.origin_artist_id <> a.id then
        v_take := least(v_take, v_foreign_cap - v_foreign_used);
        continue when v_take <= 0;
        v_foreign_used := v_foreign_used + v_take;
      end if;
      update point_lots set remaining = remaining - v_take where id = lot.id;
      insert into lot_spends (entry_id, lot_id, amount) values (v_entry, lot.id, v_take);
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then perform _fail('Недостаточно АРТов'); end if;
  end if;

  if v_earn > 0 then
    insert into point_lots (entry_id, program_id, user_id, origin_artist_id, amount, remaining, expires_at)
    values (v_entry, a.program_id, m.id, a.id, v_earn, v_earn,
            case when a.points_ttl_days is not null then now() + make_interval(days => a.points_ttl_days) end);
  end if;
  if o.id is not null then
    update orders set updated_at = now() where id = o.id;
  end if;

  return result || jsonb_build_object('entry_id', v_entry, 'balance_after', _balance(m.id, a.program_id));
end $$;

create function public.quote_operation(p_artist_user uuid, p_member_code text, p_mode text, p_amount bigint, p_redeem bigint, p_order uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  m users := find_member(p_member_code);
begin
  return _operation(a.id, m.id, p_mode, p_amount, p_redeem, false, 'cassa', p_artist_user, p_order)
    || jsonb_build_object('orders', coalesce((
         select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'price', o.price, 'stage_name', o.stages[o.stage + 1])
                          order by o.updated_at desc)
         from orders o where o.artist_id = a.id and o.user_id = m.id and o.status = 'active'), '[]'::jsonb));
end $$;

create function public.commit_operation(p_artist_user uuid, p_member_code text, p_mode text, p_amount bigint, p_redeem bigint, p_order uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return _operation((_artist_by_user(p_artist_user)).id, (find_member(p_member_code)).id,
                    p_mode, p_amount, p_redeem, true, 'cassa', p_artist_user, p_order);
end $$;

create or replace function public.claim_inline(p_ref text, p_artist uuid, p_member uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists;
  v_result jsonb;
begin
  select * into a from artists where id = p_artist and active;
  if not found then perform _fail('Художник не найден'); end if;
  if a.user_id = p_member then perform _fail('Эту кнопку нажимает клиент, а не художник'); end if;
  insert into inline_claims (ref) values (p_ref) on conflict do nothing;
  if not found then perform _fail('АРТы по этому сообщению уже получены'); end if;
  insert into memberships (program_id, user_id, source) values (a.program_id, p_member, 'inline')
  on conflict do nothing;
  v_result := _operation(a.id, p_member, 'earn', p_amount, null, true, 'inline', a.user_id, null);
  update inline_claims set entry_id = (v_result ->> 'entry_id')::uuid where ref = p_ref;
  return v_result;
end $$;

-------------------------------------------------------------------------------
-- Настройки художника: шаблон этапов
-------------------------------------------------------------------------------

create or replace function public.get_artist_settings(p_artist_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  return jsonb_build_object(
    'artist', _artist_json(a) || jsonb_build_object('order_stages', to_jsonb(a.order_stages)),
    'program', program_info(a.program_id),
    'tiers', (select jsonb_agg(jsonb_build_object('name', t.name, 'min_spent', t.min_spent, 'earn_pct', t.earn_pct,
               'pay_pct', t.pay_pct, 'foreign_pct', t.foreign_pct, 'perks', t.perks) order by t.sort)
              from tiers t where t.artist_id = a.id));
end $$;

create or replace function public.save_order_stages(p_artist_user uuid, p_stages text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  v_stages text[] := _clean_stages(p_stages);
begin
  if not _valid_stages(v_stages) then perform _fail('Этапов должно быть от 2 до 8, у каждого — название до 32 символов'); end if;
  update artists set order_stages = v_stages where id = a.id;
  return to_jsonb(v_stages);
end $$;

-------------------------------------------------------------------------------
-- Права
-------------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;
