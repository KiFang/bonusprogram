-- V1 + V2: выход из программы, коллекция, слоты, «Приведи друга», день рождения, донаты,
-- акции, сертификаты, Stars, общий сбор, Telegram Business, заявки художников.

-------------------------------------------------------------------------------
-- Общие изменения
-------------------------------------------------------------------------------

alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check
  check (kind in ('accrual', 'redeem', 'bonus', 'reversal', 'forfeit', 'donation', 'gift', 'referral', 'birthday'));
alter table public.ledger_entries add column gift_redeemed bigint not null default 0;
alter table public.point_lots add column is_gift boolean not null default false;

-- В уровень идут деньги и оплата сертификатом.
create or replace function public._spent(p_user uuid, p_artist uuid)
returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(e.paid_amount + e.gift_redeemed), 0)::bigint
  from ledger_entries e
  where e.user_id = p_user and e.artist_id = p_artist
    and e.kind in ('accrual', 'redeem')
    and not _is_reversed(e.id)
$$;

alter table public.programs add column settings jsonb not null default '{}'::jsonb;
alter table public.artists add column is_group_admin boolean not null default false;
update public.artists set is_group_admin = true
 where id in (select distinct on (program_id) id from public.artists order by program_id, created_at);

alter table public.artists
  add column slots_mode text not null default 'unlimited' check (slots_mode in ('open', 'rest', 'unlimited')),
  add column slots_total int not null default 0 check (slots_total between 0 and 100),
  add column slots_opened_at timestamptz,
  add column donate_links jsonb not null default '[]'::jsonb,
  add column donation_earn_pct numeric(5,2) check (donation_earn_pct between 0 and 100);
alter table public.tiers add column early_hours int not null default 0 check (early_hours between 0 and 168);

alter table public.users
  add column referred_by uuid references public.users,
  add column birth_day smallint check (birth_day between 1 and 31),
  add column birth_month smallint check (birth_month between 1 and 12),
  add column birthday_set_at timestamptz;

create or replace function public._artist_json(a public.artists)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'nick', a.nick, 'display_name', a.display_name, 'bio', a.bio,
    'color', a.color, 'foreign_mode', a.foreign_mode, 'points_ttl_days', a.points_ttl_days,
    'program_id', a.program_id, 'is_group_admin', a.is_group_admin, 'slots_mode', a.slots_mode)
$$;

-------------------------------------------------------------------------------
-- Настройки программы (админ группы или соло-художник)
-------------------------------------------------------------------------------

create or replace function public._program_settings(p_program uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'referral', '{"enabled": false, "friend_bonus": 100, "referrer_bonus": 100, "min_order": 1000}'::jsonb
                || coalesce(p.settings -> 'referral', '{}'::jsonb),
    'birthday', '{"mode": "off", "bonus": 300, "ttl_days": 30, "boost_pct": 5, "window_days": 3}'::jsonb
                || coalesce(p.settings -> 'birthday', '{}'::jsonb))
  from programs p where p.id = p_program
$$;

create or replace function public._program_admin(p_artist_user uuid)
returns public.artists language plpgsql stable security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  if not a.is_group_admin then perform _fail('Эти настройки меняет админ группы'); end if;
  return a;
end $$;

create or replace function public.get_program_settings(p_artist_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  return jsonb_build_object('program', program_info(a.program_id), 'is_admin', a.is_group_admin,
                            'settings', _program_settings(a.program_id),
                            'fundraiser', (select _fundraiser_json(f) from fundraisers f
                                           where f.program_id = a.program_id and f.status = 'active'));
end $$;

create or replace function public.save_program_settings(p_artist_user uuid, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _program_admin(p_artist_user);
  s jsonb := _program_settings(a.program_id);
  r jsonb;
  b jsonb;
begin
  r := s -> 'referral' || coalesce(p_settings -> 'referral', '{}'::jsonb);
  b := s -> 'birthday' || coalesce(p_settings -> 'birthday', '{}'::jsonb);
  if jsonb_typeof(r -> 'enabled') <> 'boolean'
     or (r ->> 'friend_bonus')::numeric not between 0 and 100000
     or (r ->> 'referrer_bonus')::numeric not between 0 and 100000
     or (r ->> 'min_order')::numeric not between 0 and 10000000 then
    perform _fail('Проверьте настройки «Приведи друга»: бонусы до 100 000 АРТ, минимальный заказ до 10 000 000 ₽');
  end if;
  if (b ->> 'mode') not in ('off', 'bonus', 'boost')
     or (b ->> 'bonus')::numeric not between 0 and 100000
     or (b ->> 'ttl_days')::numeric not between 1 and 365
     or (b ->> 'boost_pct')::numeric not between 0 and 50
     or (b ->> 'window_days')::numeric not between 0 and 30 then
    perform _fail('Проверьте настройки дня рождения: бонус до 100 000 АРТ, срок 1–365 дней, прибавка до 50%, окно до 30 дней');
  end if;
  r := jsonb_build_object('enabled', (r ->> 'enabled')::boolean, 'friend_bonus', floor((r ->> 'friend_bonus')::numeric),
                          'referrer_bonus', floor((r ->> 'referrer_bonus')::numeric), 'min_order', floor((r ->> 'min_order')::numeric));
  b := jsonb_build_object('mode', b ->> 'mode', 'bonus', floor((b ->> 'bonus')::numeric), 'ttl_days', floor((b ->> 'ttl_days')::numeric),
                          'boost_pct', (b ->> 'boost_pct')::numeric, 'window_days', floor((b ->> 'window_days')::numeric));
  update programs set settings = settings || jsonb_build_object('referral', r, 'birthday', b) where id = a.program_id;
  return get_program_settings(p_artist_user);
end $$;

-- Первый художник группы становится её админом; соло-художник — админ своей программы.
create or replace function public.accept_invite(p_user uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv invites;
  u users;
  v_nick text;
  v_program uuid;
  v_artist uuid;
begin
  select * into inv from invites where code = upper(btrim(p_code)) for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then
    perform _fail('Приглашение не найдено или уже использовано');
  end if;
  select * into u from users where id = p_user;
  if exists (select 1 from artists where user_id = u.id) then perform _fail('Вы уже художник Артоки'); end if;
  v_nick := lower(coalesce(u.username, ''));
  if v_nick !~ '^[a-z0-9_.]{2,32}$' then
    perform _fail('Чтобы стать художником, задайте username в настройках Telegram');
  end if;
  if exists (select 1 from artists where nick = v_nick) then perform _fail('Ник уже занят другим художником'); end if;

  v_program := inv.program_id;
  if v_program is null then
    if exists (select 1 from programs where slug = v_nick) then perform _fail('Адрес программы уже занят'); end if;
    insert into programs (type, name, slug) values ('solo', coalesce(nullif(u.first_name, ''), v_nick), v_nick)
    returning id into v_program;
  end if;

  insert into artists (user_id, program_id, nick, display_name, is_group_admin)
  values (u.id, v_program, v_nick, u.first_name, not exists (select 1 from artists where program_id = v_program))
  returning id into v_artist;
  perform _default_tiers(v_artist);
  update invites set used_by = u.id, used_at = now() where code = inv.code;
  return jsonb_build_object('artist_id', v_artist, 'program', program_info(v_program));
end $$;

-------------------------------------------------------------------------------
-- Слоты
-------------------------------------------------------------------------------

create table public.slot_requests (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references public.artists,
  user_id     uuid not null references public.users,
  comment     text not null default '' check (length(comment) <= 500),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  order_id    uuid references public.orders,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create unique index slot_requests_pending_idx on public.slot_requests (artist_id, user_id) where status = 'pending';
alter table public.slot_requests enable row level security;

create or replace function public._slots_info(p_artist uuid, p_user uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  a artists;
  v_taken int;
  v_max_early int;
  v_user_early int := 0;
  v_public_at timestamptz;
  v_access_at timestamptz;
  v_pending uuid;
begin
  select * into a from artists where id = p_artist;
  select count(*) into v_taken from orders where artist_id = a.id and status = 'active';
  select coalesce(max(early_hours), 0) into v_max_early from tiers where artist_id = a.id;
  if p_user is not null then
    v_user_early := coalesce((_tier_for(a.id, _spent(p_user, a.id))).early_hours, 0);
    select id into v_pending from slot_requests where artist_id = a.id and user_id = p_user and status = 'pending';
  end if;
  if a.slots_mode = 'open' and a.slots_opened_at is not null then
    v_public_at := a.slots_opened_at + make_interval(hours => v_max_early);
    v_access_at := v_public_at - make_interval(hours => v_user_early);
  end if;
  return jsonb_build_object(
    'mode', a.slots_mode, 'total', a.slots_total, 'taken', v_taken,
    'free', case when a.slots_mode = 'open' then greatest(a.slots_total - v_taken, 0) end,
    'opened_at', a.slots_opened_at, 'public_at', v_public_at, 'access_at', v_access_at,
    'early_hours', v_user_early, 'pending_request', v_pending,
    'can_request', p_user is not null and v_pending is null
                   and (a.slots_mode = 'unlimited'
                        or (a.slots_mode = 'open' and a.slots_total - v_taken > 0 and now() >= v_access_at)));
end $$;

create or replace function public.set_slots(p_artist_user uuid, p_mode text, p_total int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  v_reopen boolean;
begin
  if p_mode not in ('open', 'rest', 'unlimited') then perform _fail('Неизвестный режим слотов'); end if;
  if p_mode = 'open' and (p_total is null or p_total not between 1 and 100) then
    perform _fail('Число слотов — от 1 до 100');
  end if;
  v_reopen := p_mode = 'open' and (a.slots_mode <> 'open' or p_total > a.slots_total);
  update artists set slots_mode = p_mode,
                     slots_total = case when p_mode = 'open' then p_total else slots_total end,
                     slots_opened_at = case when v_reopen then now() else slots_opened_at end
   where id = a.id;
  return _slots_info(a.id, null) || jsonb_build_object(
    'announce', v_reopen,
    'artist', jsonb_build_object('nick', a.nick),
    'notify', case when v_reopen then coalesce((
      select jsonb_agg(jsonb_build_object('telegram_id', u.telegram_id, 'access_at', _slots_info(a.id, u.id) -> 'access_at'))
      from memberships m join users u on u.id = m.user_id
      where m.program_id = a.program_id and u.id <> a.user_id), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.request_slot(p_user uuid, p_artist uuid, p_comment text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists;
  u users;
  info jsonb;
  v_id uuid;
begin
  select * into a from artists where id = p_artist and active;
  if not found then perform _fail('Художник не найден'); end if;
  select * into u from users where id = p_user;
  if not exists (select 1 from memberships where program_id = a.program_id and user_id = p_user) then
    perform _fail('Сначала вступите в программу художника');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('slots' || a.id::text, 0));
  info := _slots_info(a.id, p_user);
  if a.slots_mode = 'rest' then perform _fail('Художник сейчас отдыхает и не берёт заказы'); end if;
  if info ->> 'pending_request' is not null then perform _fail('Заявка уже отправлена, дождитесь ответа художника'); end if;
  if a.slots_mode = 'open' then
    if (info ->> 'free')::int <= 0 then perform _fail('Свободных слотов нет'); end if;
    if now() < (info ->> 'access_at')::timestamptz then
      perform _fail(format('Для вашего уровня слоты откроются %s (МСК)',
        to_char((info ->> 'access_at')::timestamptz at time zone 'Europe/Moscow', 'DD.MM в HH24:MI')));
    end if;
  end if;
  insert into slot_requests (artist_id, user_id, comment) values (a.id, p_user, left(btrim(coalesce(p_comment, '')), 500))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'artist_telegram_id', (select telegram_id from users where id = a.user_id),
    'artist', jsonb_build_object('nick', a.nick), 'member', jsonb_build_object('name', u.first_name, 'code', u.member_code),
    'comment', left(btrim(coalesce(p_comment, '')), 500), 'tier', _tier_json(p_user, a.id));
end $$;

create or replace function public.withdraw_slot_request(p_user uuid, p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update slot_requests set status = 'withdrawn', decided_at = now()
   where id = p_request and user_id = p_user and status = 'pending';
  if not found then perform _fail('Заявка не найдена'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.artist_slot_requests(p_artist_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'comment', r.comment, 'created_at', r.created_at,
             'member', jsonb_build_object('name', u.first_name, 'code', u.member_code), 'tier', _tier_json(u.id, a.id))
           order by r.created_at)
    from slot_requests r join users u on u.id = r.user_id
    where r.artist_id = a.id and r.status = 'pending'), '[]'::jsonb);
end $$;

create or replace function public.decide_slot_request(p_artist_user uuid, p_request uuid, p_accept boolean, p_title text, p_price bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  r slot_requests;
  u users;
  v_order jsonb;
begin
  select * into r from slot_requests where id = p_request and artist_id = a.id and status = 'pending' for update;
  if not found then perform _fail('Заявка не найдена или уже рассмотрена'); end if;
  select * into u from users where id = r.user_id;
  if p_accept then
    if a.slots_mode = 'open' and (_slots_info(a.id, null) ->> 'free')::int <= 0 then
      perform _fail('Свободных слотов нет. Увеличьте число слотов или завершите заказ.');
    end if;
    v_order := create_order(p_artist_user, u.member_code,
                            coalesce(nullif(btrim(p_title), ''), nullif(left(r.comment, 80), ''), 'Заказ по слоту'), p_price, null);
    update slot_requests set status = 'accepted', decided_at = now(), order_id = (v_order ->> 'id')::uuid where id = r.id;
  else
    update slot_requests set status = 'declined', decided_at = now() where id = r.id;
  end if;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end,
    'order', v_order, 'member_telegram_id', u.telegram_id, 'artist', jsonb_build_object('nick', a.nick));
end $$;

-------------------------------------------------------------------------------
-- Выход из программы
-------------------------------------------------------------------------------

create or replace function public.leave_program(p_user uuid, p_program uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p programs;
  v_bal bigint;
begin
  select * into p from programs where id = p_program;
  if not exists (select 1 from memberships where program_id = p_program and user_id = p_user) then
    perform _fail('Вы не состоите в этой программе');
  end if;
  if exists (select 1 from slot_requests r join artists a on a.id = r.artist_id
             where r.user_id = p_user and a.program_id = p_program and r.status = 'pending') then
    perform _fail('Сначала отмените заявку на слот');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_program::text || p_user::text, 0));
  v_bal := _balance(p_user, p_program);
  if v_bal > 0 then
    insert into ledger_entries (program_id, user_id, kind, points, source, created_by)
    values (p_program, p_user, 'forfeit', -v_bal, 'app', p_user);
  end if;
  update point_lots set remaining = 0 where user_id = p_user and program_id = p_program and remaining > 0;
  delete from memberships where program_id = p_program and user_id = p_user;
  return jsonb_build_object('program', jsonb_build_object('id', p.id, 'name', p.name), 'forfeited', v_bal);
end $$;

-- Отмена операции у вышедшего клиента вернула бы ему сгоревшие АРТы — запрещаем.
create or replace function public.cancel_operation(p_artist_user uuid, p_entry uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  e ledger_entries;
  m users;
  v_rev uuid;
begin
  select * into e from ledger_entries where id = p_entry and artist_id = a.id and kind in ('accrual', 'redeem');
  if not found then perform _fail('Операция не найдена'); end if;
  perform pg_advisory_xact_lock(hashtextextended(e.program_id::text || e.user_id::text, 0));
  if _is_reversed(e.id) then perform _fail('Операция уже отменена'); end if;
  if e.created_at < now() - interval '24 hours' then perform _fail('Отменить можно только в течение 24 часов'); end if;
  if not exists (select 1 from memberships where program_id = e.program_id and user_id = e.user_id) then
    perform _fail('Клиент вышел из программы, операцию отменить нельзя');
  end if;
  if exists (select 1 from point_lots where entry_id = e.id and remaining < amount) then
    perform _fail('АРТы из этой операции уже потрачены, отменить её нельзя');
  end if;

  update point_lots set remaining = 0 where entry_id = e.id;
  update point_lots l set remaining = l.remaining + s.amount
    from lot_spends s where s.entry_id = e.id and s.lot_id = l.id;

  insert into ledger_entries (program_id, user_id, artist_id, kind, points, reverses_id, source, created_by)
  values (e.program_id, e.user_id, e.artist_id, 'reversal', -e.points, e.id, 'cassa', p_artist_user)
  returning id into v_rev;

  select * into m from users where id = e.user_id;
  return jsonb_build_object(
    'entry', _entry_json(e), 'reversal_id', v_rev,
    'member', jsonb_build_object('id', m.id, 'name', m.first_name, 'code', m.member_code, 'telegram_id', m.telegram_id),
    'artist', jsonb_build_object('id', a.id, 'nick', a.nick),
    'program', (select jsonb_build_object('id', p.id, 'name', p.name) from programs p where p.id = e.program_id),
    'balance_after', _balance(e.user_id, e.program_id));
end $$;

-------------------------------------------------------------------------------
-- Коллекция артов
-------------------------------------------------------------------------------

create table public.gallery_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references public.orders on delete set null,
  artist_id     uuid not null references public.artists,
  user_id       uuid not null references public.users,
  storage_path  text not null unique,
  nsfw          boolean not null default false,
  hidden        boolean not null default false,
  created_at    timestamptz not null default now()
);
create index gallery_user_idx on public.gallery_items (user_id, created_at desc);
create index gallery_order_idx on public.gallery_items (order_id);
alter table public.gallery_items enable row level security;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('art', 'art', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end $$;

create or replace function public._gallery_json(g public.gallery_items)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', g.id, 'path', g.storage_path, 'nsfw', g.nsfw, 'hidden', g.hidden,
    'created_at', g.created_at, 'order_id', g.order_id,
    'order_title', (select o.title from orders o where o.id = g.order_id),
    'artist', (select jsonb_build_object('id', a.id, 'nick', a.nick, 'color', a.color, 'display_name', a.display_name)
               from artists a where a.id = g.artist_id))
$$;

create or replace function public.add_gallery_item(p_artist_user uuid, p_order uuid, p_path text, p_nsfw boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o orders := _artist_order(p_artist_user, p_order);
  g gallery_items;
begin
  if p_path is null or p_path not like o.artist_id::text || '/%' then perform _fail('Некорректный путь файла'); end if;
  if (select count(*) from gallery_items where order_id = o.id) >= 20 then perform _fail('К заказу можно приложить до 20 картинок'); end if;
  insert into gallery_items (order_id, artist_id, user_id, storage_path, nsfw)
  values (o.id, o.artist_id, o.user_id, p_path, coalesce(p_nsfw, false)) returning * into g;
  return _gallery_json(g) || jsonb_build_object('member_telegram_id', _member_tg(o.user_id), 'order_title', o.title,
                                                'artist_nick', (select nick from artists where id = o.artist_id));
end $$;

create or replace function public.delete_gallery_item(p_artist_user uuid, p_item uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  v_path text;
begin
  delete from gallery_items where id = p_item and artist_id = a.id returning storage_path into v_path;
  if v_path is null then perform _fail('Картинка не найдена'); end if;
  return v_path;
end $$;

create or replace function public.member_gallery(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(_gallery_json(g) order by g.created_at desc), '[]'::jsonb)
  from gallery_items g where g.user_id = p_user
$$;

create or replace function public.set_gallery_hidden(p_user uuid, p_item uuid, p_hidden boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g gallery_items;
begin
  update gallery_items set hidden = coalesce(p_hidden, false) where id = p_item and user_id = p_user returning * into g;
  if not found then perform _fail('Картинка не найдена'); end if;
  return _gallery_json(g);
end $$;

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
                          from ledger_entries e where e.order_id = o.id and e.kind in ('accrual', 'redeem')), '[]'::jsonb),
    'gallery', coalesce((select jsonb_agg(_gallery_json(g) order by g.created_at)
                         from gallery_items g where g.order_id = o.id), '[]'::jsonb));
end $$;

-------------------------------------------------------------------------------
-- Приведи друга
-------------------------------------------------------------------------------

create table public.referrals (
  referee_id      uuid primary key references public.users,
  referrer_id     uuid not null references public.users,
  program_id      uuid references public.programs,
  friend_bonus    bigint,
  referrer_bonus  bigint,
  rewarded_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index referrals_referrer_idx on public.referrals (referrer_id);
alter table public.referrals enable row level security;

create or replace function public.set_referrer(p_user uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  r users;
begin
  if v_code ~ '^KF[2-9A-Z]{4}$' then v_code := 'KF-' || substr(v_code, 3); end if;
  select * into r from users where member_code = v_code;
  if not found or r.id = p_user then return jsonb_build_object('status', 'invalid'); end if;
  if exists (select 1 from referrals where referee_id = p_user) then return jsonb_build_object('status', 'already'); end if;
  if exists (select 1 from ledger_entries where user_id = p_user) or exists (select 1 from artists where user_id = p_user) then
    return jsonb_build_object('status', 'too_late');
  end if;
  insert into referrals (referee_id, referrer_id) values (p_user, r.id);
  update users set referred_by = r.id where id = p_user;
  return jsonb_build_object('status', 'ok', 'referrer', jsonb_build_object('name', r.first_name));
end $$;

create or replace function public._grant_points(p_user uuid, p_program uuid, p_kind text, p_points bigint, p_ttl_days int, p_source text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_entry uuid;
begin
  insert into ledger_entries (program_id, user_id, kind, points, earned, source)
  values (p_program, p_user, p_kind, p_points, p_points, p_source) returning id into v_entry;
  if p_points > 0 then
    insert into point_lots (entry_id, program_id, user_id, origin_artist_id, amount, remaining, expires_at)
    values (v_entry, p_program, p_user, null, p_points, p_points,
            case when p_ttl_days is not null then now() + make_interval(days => p_ttl_days) end);
  end if;
  return v_entry;
end $$;

create or replace function public._referral_reward(p_user uuid, p_program uuid, p_paid bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r referrals;
  s jsonb := _program_settings(p_program) -> 'referral';
  v_friend bigint := (s ->> 'friend_bonus')::bigint;
  v_ref bigint := (s ->> 'referrer_bonus')::bigint;
begin
  select * into r from referrals where referee_id = p_user and rewarded_at is null for update;
  if not found or not (s ->> 'enabled')::boolean or p_paid < (s ->> 'min_order')::bigint then return null; end if;
  if v_friend > 0 then perform _grant_points(p_user, p_program, 'referral', v_friend, null, 'referral'); end if;
  if v_ref > 0 then
    insert into memberships (program_id, user_id, source) values (p_program, r.referrer_id, 'referral') on conflict do nothing;
    perform _grant_points(r.referrer_id, p_program, 'referral', v_ref, null, 'referral');
  end if;
  update referrals set rewarded_at = now(), program_id = p_program, friend_bonus = v_friend, referrer_bonus = v_ref
   where referee_id = p_user;
  return jsonb_build_object(
    'friend_bonus', v_friend, 'referrer_bonus', v_ref,
    'referrer_telegram_id', (select telegram_id from users where id = r.referrer_id),
    'friend_name', (select first_name from users where id = p_user),
    'program', (select name from programs where id = p_program));
end $$;

create or replace function public.my_referrals(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', (select member_code from users where id = p_user),
    'invited', (select count(*) from referrals where referrer_id = p_user),
    'rewarded', (select count(*) from referrals where referrer_id = p_user and rewarded_at is not null),
    'earned', (select coalesce(sum(referrer_bonus), 0) from referrals where referrer_id = p_user and rewarded_at is not null),
    'programs', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'referral', _program_settings(p.id) -> 'referral'))
                          from memberships m join programs p on p.id = m.program_id where m.user_id = p_user), '[]'::jsonb))
$$;

-------------------------------------------------------------------------------
-- День рождения
-------------------------------------------------------------------------------

create table public.birthday_grants (
  program_id  uuid not null references public.programs,
  user_id     uuid not null references public.users,
  year        int not null,
  entry_id    uuid references public.ledger_entries,
  created_at  timestamptz not null default now(),
  primary key (program_id, user_id, year)
);
alter table public.birthday_grants enable row level security;

create or replace function public._birthday_in(p_year int, p_day int, p_month int)
returns date language sql immutable set search_path = public as $$
  select case when p_month = 2 and p_day = 29 and not (p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0))
              then make_date(p_year, 2, 28) else make_date(p_year, p_month, p_day) end
$$;

create or replace function public._birthday_distance(p_user uuid)
returns int language sql stable set search_path = public as $$
  select min(abs(_birthday_in(y, u.birth_day, u.birth_month) - (now() at time zone 'Europe/Moscow')::date))
  from users u,
       generate_series(extract(year from now() at time zone 'Europe/Moscow')::int - 1,
                       extract(year from now() at time zone 'Europe/Moscow')::int + 1) y
  where u.id = p_user and u.birth_day is not null and u.birth_month is not null
$$;

create or replace function public.set_birthday(p_user uuid, p_day int, p_month int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u users;
begin
  select * into u from users where id = p_user;
  begin
    perform make_date(2000, p_month, p_day);
  exception when others then
    perform _fail('Такой даты нет');
  end;
  if u.birthday_set_at is not null and u.birthday_set_at > now() - interval '365 days'
     and (u.birth_day, u.birth_month) is distinct from (p_day::smallint, p_month::smallint) then
    perform _fail('Дату рождения можно менять раз в год');
  end if;
  update users set birth_day = p_day, birth_month = p_month,
                   birthday_set_at = case when (birth_day, birth_month) is distinct from (p_day::smallint, p_month::smallint)
                                          then now() else birthday_set_at end
   where id = p_user;
  return jsonb_build_object('day', p_day, 'month', p_month);
end $$;

-- Вызывается раз в день по расписанию: начисляет бонус тем, у кого сегодня день рождения.
create or replace function public.grant_birthday_bonuses()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rec record;
  v_entry uuid;
  v_year int := extract(year from now() at time zone 'Europe/Moscow')::int;
  result jsonb := '[]'::jsonb;
begin
  for rec in
    select p.id as program_id, p.name as program_name, u.id as user_id, u.telegram_id, u.first_name,
           (_program_settings(p.id) -> 'birthday') as s
    from programs p
    join memberships m on m.program_id = p.id
    join users u on u.id = m.user_id
    where (_program_settings(p.id) -> 'birthday' ->> 'mode') = 'bonus'
      and (_program_settings(p.id) -> 'birthday' ->> 'bonus')::bigint > 0
      and _birthday_distance(u.id) = 0
      and not exists (select 1 from birthday_grants g where g.program_id = p.id and g.user_id = u.id and g.year = v_year)
  loop
    v_entry := _grant_points(rec.user_id, rec.program_id, 'birthday', (rec.s ->> 'bonus')::bigint, (rec.s ->> 'ttl_days')::int, 'birthday');
    insert into birthday_grants (program_id, user_id, year, entry_id) values (rec.program_id, rec.user_id, v_year, v_entry);
    result := result || jsonb_build_object('telegram_id', rec.telegram_id, 'name', rec.first_name, 'program', rec.program_name,
                                           'bonus', (rec.s ->> 'bonus')::bigint, 'ttl_days', (rec.s ->> 'ttl_days')::int);
  end loop;
  return result;
end $$;

-------------------------------------------------------------------------------
-- Акции
-------------------------------------------------------------------------------

create table public.promotions (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references public.artists on delete cascade,
  title       text not null check (length(title) between 1 and 60),
  multiplier  numeric(4,2) not null check (multiplier between 1 and 5),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index promotions_artist_idx on public.promotions (artist_id, ends_at);
alter table public.promotions enable row level security;

create or replace function public._active_promotion(p_artist uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', p.id, 'title', p.title, 'multiplier', p.multiplier, 'starts_at', p.starts_at, 'ends_at', p.ends_at)
  from promotions p where p.artist_id = p_artist and now() between p.starts_at and p.ends_at
  order by p.multiplier desc limit 1
$$;

create or replace function public.create_promotion(p_artist_user uuid, p_title text, p_multiplier numeric, p_starts timestamptz, p_ends timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  v_id uuid;
begin
  if length(btrim(coalesce(p_title, ''))) not between 1 and 60 then perform _fail('Название акции — от 1 до 60 символов'); end if;
  if p_multiplier is null or p_multiplier not between 1.1 and 5 then perform _fail('Множитель — от 1,1 до 5'); end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then perform _fail('Конец акции должен быть позже начала'); end if;
  if p_ends < now() then perform _fail('Акция уже закончилась бы'); end if;
  if p_ends - p_starts > interval '92 days' then perform _fail('Акция — не дольше 3 месяцев'); end if;
  insert into promotions (artist_id, title, multiplier, starts_at, ends_at)
  values (a.id, btrim(p_title), p_multiplier, p_starts, p_ends) returning id into v_id;
  return artist_promotions(p_artist_user);
end $$;

create or replace function public.delete_promotion(p_artist_user uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  delete from promotions where id = p_id and artist_id = a.id;
  if not found then perform _fail('Акция не найдена'); end if;
  return artist_promotions(p_artist_user);
end $$;

create or replace function public.artist_promotions(p_artist_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'multiplier', p.multiplier,
                            'starts_at', p.starts_at, 'ends_at', p.ends_at, 'active', now() between p.starts_at and p.ends_at)
                          order by p.starts_at)
                   from promotions p where p.artist_id = a.id and p.ends_at > now()), '[]'::jsonb);
end $$;

-------------------------------------------------------------------------------
-- Донаты
-------------------------------------------------------------------------------

create or replace function public.save_donation_settings(p_artist_user uuid, p_links jsonb, p_pct numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  l jsonb;
  v_links jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_links, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_links, '[]'::jsonb)) > 5 then
    perform _fail('Можно добавить до 5 ссылок');
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    if length(btrim(coalesce(l ->> 'title', ''))) not between 1 and 32 then perform _fail('Название ссылки — от 1 до 32 символов'); end if;
    if coalesce(l ->> 'url', '') !~ '^https?://\S{3,}$' or length(l ->> 'url') > 300 then
      perform _fail(format('Ссылка «%s» должна начинаться с https://', l ->> 'title'));
    end if;
    v_links := v_links || jsonb_build_object('title', btrim(l ->> 'title'), 'url', btrim(l ->> 'url'));
  end loop;
  if p_pct is not null and p_pct not between 0 and 100 then perform _fail('Процент — от 0 до 100'); end if;
  update artists set donate_links = v_links, donation_earn_pct = p_pct where id = a.id;
  return jsonb_build_object('links', v_links, 'earn_pct', p_pct);
end $$;

create or replace function public._record_donation(p_artist uuid, p_user uuid, p_amount bigint, p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists;
  m users;
  v_points bigint;
  v_entry uuid;
begin
  select * into a from artists where id = p_artist and active;
  if not found then perform _fail('Художник не найден'); end if;
  select * into m from users where id = p_user;
  if m.id = a.user_id then perform _fail('Нельзя отметить донат самому себе'); end if;
  if p_amount is null or p_amount not between 1 and 10000000 then perform _fail('Сумма доната — от 1 до 10 000 000 ₽'); end if;
  insert into memberships (program_id, user_id, source) values (a.program_id, m.id, 'donation') on conflict do nothing;
  v_points := coalesce(floor(p_amount * a.donation_earn_pct / 100), 0);
  insert into ledger_entries (program_id, user_id, artist_id, kind, order_amount, earned, points, source, created_by)
  values (a.program_id, m.id, a.id, 'donation', p_amount, v_points, v_points, p_source, a.user_id) returning id into v_entry;
  if v_points > 0 then
    insert into point_lots (entry_id, program_id, user_id, origin_artist_id, amount, remaining, expires_at)
    values (v_entry, a.program_id, m.id, a.id, v_points, v_points,
            case when a.points_ttl_days is not null then now() + make_interval(days => a.points_ttl_days) end);
  end if;
  return jsonb_build_object('amount', p_amount, 'points', v_points, 'entry_id', v_entry,
    'member', jsonb_build_object('name', m.first_name, 'code', m.member_code, 'telegram_id', m.telegram_id),
    'artist', jsonb_build_object('id', a.id, 'nick', a.nick, 'telegram_id', (select telegram_id from users where id = a.user_id)),
    'program', (select jsonb_build_object('id', p.id, 'name', p.name) from programs p where p.id = a.program_id),
    'balance_after', _balance(m.id, a.program_id));
end $$;

create or replace function public.record_donation(p_artist_user uuid, p_member_code text, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return _record_donation((_artist_by_user(p_artist_user)).id, (find_member(p_member_code)).id, p_amount, 'manual');
end $$;

-------------------------------------------------------------------------------
-- Подарочные сертификаты
-------------------------------------------------------------------------------

create table public.gift_certificates (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  program_id    uuid not null references public.programs,
  artist_id     uuid references public.artists,        -- null = сертификат группы
  amount        bigint not null check (amount between 1 and 1000000),
  status        text not null default 'issued' check (status in ('issued', 'activated', 'void')),
  issued_by     uuid references public.users,
  buyer_id      uuid references public.users,
  activated_by  uuid references public.users,
  activated_at  timestamptz,
  entry_id      uuid references public.ledger_entries,
  paid_via      text not null default 'artist' check (paid_via in ('artist', 'stars')),
  note          text not null default '' check (length(note) <= 120),
  expires_at    timestamptz not null default now() + interval '365 days',
  created_at    timestamptz not null default now()
);
create index gift_certificates_program_idx on public.gift_certificates (program_id, created_at desc);
alter table public.gift_certificates enable row level security;

create or replace function public._certificate_json(c public.gift_certificates)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', c.id, 'code', c.code, 'amount', c.amount, 'status', c.status, 'note', c.note,
    'scope', case when c.artist_id is null then 'group' else 'artist' end, 'paid_via', c.paid_via,
    'expires_at', c.expires_at, 'created_at', c.created_at, 'activated_at', c.activated_at,
    'program', (select jsonb_build_object('id', p.id, 'name', p.name, 'type', p.type) from programs p where p.id = c.program_id),
    'artist', (select jsonb_build_object('id', a.id, 'nick', a.nick) from artists a where a.id = c.artist_id),
    'activated_by', (select first_name from users where id = c.activated_by))
$$;

create or replace function public._issue_certificate(p_artist uuid, p_scope text, p_amount bigint, p_issuer uuid, p_buyer uuid, p_via text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists;
  c gift_certificates;
  v_code text;
begin
  select * into a from artists where id = p_artist and active;
  if not found then perform _fail('Художник не найден'); end if;
  if p_scope not in ('artist', 'group') then perform _fail('Неизвестный вид сертификата'); end if;
  if p_scope = 'group' and (select type from programs where id = a.program_id) <> 'group' then
    perform _fail('Сертификат группы выпускают художники группы');
  end if;
  if p_amount is null or p_amount not between 100 and 1000000 then perform _fail('Номинал — от 100 до 1 000 000 АРТ'); end if;
  loop
    v_code := _gen_code('G-', 8);
    begin
      insert into gift_certificates (code, program_id, artist_id, amount, issued_by, buyer_id, paid_via, note)
      values (v_code, a.program_id, case when p_scope = 'artist' then a.id end, p_amount, p_issuer, p_buyer, p_via,
              left(btrim(coalesce(p_note, '')), 120))
      returning * into c;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;
  return _certificate_json(c);
end $$;

create or replace function public.issue_certificate(p_artist_user uuid, p_scope text, p_amount bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return _issue_certificate((_artist_by_user(p_artist_user)).id, p_scope, p_amount, p_artist_user, null, 'artist', p_note);
end $$;

create or replace function public.certificate_info(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c gift_certificates;
begin
  select * into c from gift_certificates where code = upper(btrim(p_code));
  if not found then perform _fail('Сертификат не найден'); end if;
  return _certificate_json(c);
end $$;

create or replace function public.activate_certificate(p_user uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c gift_certificates;
  v_entry uuid;
begin
  select * into c from gift_certificates where code = upper(btrim(p_code)) for update;
  if not found then perform _fail('Сертификат не найден'); end if;
  if c.status = 'activated' then perform _fail('Сертификат уже активирован'); end if;
  if c.status = 'void' then perform _fail('Сертификат аннулирован'); end if;
  if c.expires_at < now() then perform _fail('Срок сертификата истёк'); end if;
  if exists (select 1 from artists where user_id = p_user and (id = c.artist_id or (c.artist_id is null and program_id = c.program_id))) then
    perform _fail('Художник не может активировать свой сертификат');
  end if;
  insert into memberships (program_id, user_id, source) values (c.program_id, p_user, 'gift') on conflict do nothing;
  insert into ledger_entries (program_id, user_id, artist_id, kind, points, earned, source)
  values (c.program_id, p_user, c.artist_id, 'gift', c.amount, c.amount, 'gift') returning id into v_entry;
  insert into point_lots (entry_id, program_id, user_id, origin_artist_id, amount, remaining, is_gift)
  values (v_entry, c.program_id, p_user, c.artist_id, c.amount, c.amount, true);
  update gift_certificates set status = 'activated', activated_by = p_user, activated_at = now(), entry_id = v_entry where id = c.id
  returning * into c;
  return _certificate_json(c) || jsonb_build_object('balance_after', _balance(p_user, c.program_id),
    'issuer_telegram_id', (select telegram_id from users where id = c.issued_by));
end $$;

create or replace function public.void_certificate(p_artist_user uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  c gift_certificates;
begin
  update gift_certificates set status = 'void'
   where id = p_id and status = 'issued' and program_id = a.program_id and issued_by = p_artist_user and paid_via = 'artist'
  returning * into c;
  if not found then perform _fail('Аннулировать можно только свой неактивированный сертификат'); end if;
  return _certificate_json(c);
end $$;

create or replace function public.artist_certificates(p_artist_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  return coalesce((select jsonb_agg(_certificate_json(c) order by c.created_at desc)
                   from gift_certificates c
                   where c.program_id = a.program_id and (c.artist_id = a.id or c.artist_id is null)
                     and c.created_at > now() - interval '400 days'), '[]'::jsonb);
end $$;

-------------------------------------------------------------------------------
-- Общий сбор группы
-------------------------------------------------------------------------------

create table public.fundraisers (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs,
  title       text not null check (length(title) between 1 and 80),
  goal        bigint not null check (goal between 1 and 100000000),
  status      text not null default 'active' check (status in ('active', 'closed')),
  created_by  uuid references public.users,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create unique index fundraisers_active_idx on public.fundraisers (program_id) where status = 'active';

create table public.fundraiser_contributions (
  id             uuid primary key default gen_random_uuid(),
  fundraiser_id  uuid not null references public.fundraisers,
  user_id        uuid references public.users,
  amount         bigint not null check (amount between 1 and 100000000),
  source         text not null check (source in ('manual', 'stars')),
  note           text not null default '' check (length(note) <= 120),
  created_by     uuid references public.users,
  created_at     timestamptz not null default now()
);
create index fundraiser_contributions_idx on public.fundraiser_contributions (fundraiser_id);
alter table public.fundraisers enable row level security;
alter table public.fundraiser_contributions enable row level security;

create or replace function public._fundraiser_json(f public.fundraisers)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', f.id, 'title', f.title, 'goal', f.goal, 'status', f.status, 'created_at', f.created_at,
    'raised', (select coalesce(sum(amount), 0) from fundraiser_contributions where fundraiser_id = f.id),
    'count', (select count(*) from fundraiser_contributions where fundraiser_id = f.id))
$$;

create or replace function public.create_fundraiser(p_artist_user uuid, p_title text, p_goal bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _program_admin(p_artist_user);
  f fundraisers;
begin
  if (select type from programs where id = a.program_id) <> 'group' then perform _fail('Общий сбор доступен группам'); end if;
  if exists (select 1 from fundraisers where program_id = a.program_id and status = 'active') then
    perform _fail('Сначала завершите текущий сбор');
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 80 then perform _fail('Название сбора — от 1 до 80 символов'); end if;
  if p_goal is null or p_goal not between 100 and 100000000 then perform _fail('Цель — от 100 до 100 000 000 ₽'); end if;
  insert into fundraisers (program_id, title, goal, created_by) values (a.program_id, btrim(p_title), p_goal, p_artist_user)
  returning * into f;
  return _fundraiser_json(f);
end $$;

create or replace function public.close_fundraiser(p_artist_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _program_admin(p_artist_user);
  f fundraisers;
begin
  update fundraisers set status = 'closed', closed_at = now() where program_id = a.program_id and status = 'active'
  returning * into f;
  if not found then perform _fail('Активного сбора нет'); end if;
  return _fundraiser_json(f);
end $$;

create or replace function public._add_contribution(p_fundraiser uuid, p_user uuid, p_amount bigint, p_source text, p_note text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f fundraisers;
begin
  select * into f from fundraisers where id = p_fundraiser and status = 'active';
  if not found then perform _fail('Сбор не найден или завершён'); end if;
  if p_amount is null or p_amount not between 1 and 100000000 then perform _fail('Некорректная сумма'); end if;
  insert into fundraiser_contributions (fundraiser_id, user_id, amount, source, note, created_by)
  values (f.id, p_user, p_amount, p_source, left(btrim(coalesce(p_note, '')), 120), p_by);
  return _fundraiser_json(f);
end $$;

create or replace function public.add_contribution(p_artist_user uuid, p_amount bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  v_id uuid;
begin
  select id into v_id from fundraisers where program_id = a.program_id and status = 'active';
  if v_id is null then perform _fail('Активного сбора нет'); end if;
  return _add_contribution(v_id, null, p_amount, 'manual', p_note, p_artist_user);
end $$;

-------------------------------------------------------------------------------
-- Оплата Telegram Stars (1 АРТ = 0,5 ★)
-------------------------------------------------------------------------------

create table public.stars_invoices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users,
  kind           text not null check (kind in ('certificate', 'donation', 'fundraiser')),
  artist_id      uuid references public.artists,
  program_id     uuid references public.programs,
  fundraiser_id  uuid references public.fundraisers,
  scope          text,
  arts           bigint not null check (arts between 1 and 1000000),
  stars          int not null check (stars between 1 and 100000),
  status         text not null default 'pending' check (status in ('pending', 'paid')),
  charge_id      text unique,
  result         jsonb,
  paid_at        timestamptz,
  paid_out_at    timestamptz,
  created_at     timestamptz not null default now()
);
alter table public.stars_invoices enable row level security;

create or replace function public.create_stars_invoice(p_user uuid, p_kind text, p_target uuid, p_scope text, p_arts bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists;
  f fundraisers;
  v_id uuid;
  v_stars int;
  v_title text;
  v_desc text;
begin
  if p_arts is null or p_arts not between 10 and 1000000 then perform _fail('Сумма — от 10 до 1 000 000 АРТ'); end if;
  v_stars := ceil(p_arts / 2.0)::int;
  if p_kind in ('certificate', 'donation') then
    select * into a from artists where id = p_target and active;
    if not found then perform _fail('Художник не найден'); end if;
    if a.user_id = p_user then perform _fail('Нельзя оплатить самому себе'); end if;
    if p_kind = 'certificate' then
      if p_scope not in ('artist', 'group') then perform _fail('Неизвестный вид сертификата'); end if;
      if p_arts < 100 then perform _fail('Сертификат — от 100 АРТ'); end if;
      if p_scope = 'group' and (select type from programs where id = a.program_id) <> 'group' then
        perform _fail('У художника нет группы');
      end if;
      v_title := format('Сертификат на %s АРТ', p_arts);
      v_desc := case when p_scope = 'group' then format('Подарочный сертификат группы «%s»', (select name from programs where id = a.program_id))
                     else format('Подарочный сертификат @%s', a.nick) end;
    else
      v_title := format('Донат @%s', a.nick);
      v_desc := format('Поддержка художника @%s: %s ₽', a.nick, p_arts);
    end if;
  elsif p_kind = 'fundraiser' then
    select * into f from fundraisers where id = p_target and status = 'active';
    if not found then perform _fail('Сбор не найден или завершён'); end if;
    v_title := format('Взнос в сбор «%s»', left(f.title, 20));
    v_desc := format('Общий сбор группы «%s»: %s ₽', (select name from programs where id = f.program_id), p_arts);
  else
    perform _fail('Неизвестный тип оплаты');
  end if;
  insert into stars_invoices (user_id, kind, artist_id, program_id, fundraiser_id, scope, arts, stars)
  values (p_user, p_kind, a.id, coalesce(a.program_id, f.program_id), f.id, p_scope, p_arts, v_stars) returning id into v_id;
  return jsonb_build_object('id', v_id, 'stars', v_stars, 'title', left(v_title, 32), 'description', left(v_desc, 255));
end $$;

create or replace function public.check_stars_invoice(p_id uuid, p_stars int, p_payer_tg bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from stars_invoices i join users u on u.id = i.user_id
                 where i.id = p_id and i.status = 'pending' and i.stars = p_stars and u.telegram_id = p_payer_tg)
$$;

create or replace function public.complete_stars_invoice(p_id uuid, p_charge_id text, p_stars int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i stars_invoices;
  r jsonb;
begin
  select * into i from stars_invoices where id = p_id for update;
  if not found then perform _fail('Счёт не найден'); end if;
  if i.status = 'paid' then return i.result || jsonb_build_object('duplicate', true); end if;
  if p_stars <> i.stars then perform _fail('Сумма оплаты не совпадает со счётом'); end if;
  if i.kind = 'certificate' then
    r := _issue_certificate(i.artist_id, i.scope, i.arts, null, i.user_id, 'stars', 'Куплен за Stars');
  elsif i.kind = 'donation' then
    r := _record_donation(i.artist_id, i.user_id, i.arts, 'stars');
  else
    r := _add_contribution(i.fundraiser_id, i.user_id, i.arts, 'stars', 'Stars', i.user_id);
  end if;
  r := jsonb_build_object('kind', i.kind, 'arts', i.arts, 'stars', i.stars, 'data', r,
    'payer_telegram_id', (select telegram_id from users where id = i.user_id),
    'artist_telegram_id', (select u.telegram_id from artists a join users u on u.id = a.user_id where a.id = i.artist_id));
  update stars_invoices set status = 'paid', charge_id = p_charge_id, result = r, paid_at = now() where id = i.id;
  return r;
end $$;

-- Для админа: сколько звёзд собрано и не выплачено художникам (и группам — за сборы).
create or replace function public.stars_payouts()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'who'), '[]'::jsonb) from (
    select jsonb_build_object('who', coalesce('@' || a.nick, 'группа «' || p.name || '»'), 'stars', sum(i.stars), 'arts', sum(i.arts),
                              'count', count(*)) as x
    from stars_invoices i
    left join artists a on a.id = i.artist_id
    left join programs p on p.id = i.program_id
    where i.status = 'paid' and i.paid_out_at is null
    group by a.nick, p.name) t
$$;

create or replace function public.mark_stars_paid(p_who text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  update stars_invoices i set paid_out_at = now()
   where i.status = 'paid' and i.paid_out_at is null
     and ((i.artist_id is not null and i.artist_id = (select id from artists where nick = _norm(p_who)))
          or (i.artist_id is null and i.program_id = (select id from programs where slug = _norm(p_who))));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-------------------------------------------------------------------------------
-- Telegram Business: /addart в переписке художника с клиентом
-------------------------------------------------------------------------------

create table public.business_connections (
  id                text primary key,
  user_telegram_id  bigint not null,
  can_reply         boolean not null default false,
  is_enabled        boolean not null default true,
  updated_at        timestamptz not null default now()
);
alter table public.business_connections enable row level security;

create or replace function public.save_business_connection(p_id text, p_user_tg bigint, p_can_reply boolean, p_enabled boolean)
returns void language sql security definer set search_path = public as $$
  insert into business_connections (id, user_telegram_id, can_reply, is_enabled)
  values (p_id, p_user_tg, coalesce(p_can_reply, false), coalesce(p_enabled, true))
  on conflict (id) do update set user_telegram_id = excluded.user_telegram_id, can_reply = excluded.can_reply,
                                 is_enabled = excluded.is_enabled, updated_at = now()
$$;

create or replace function public.business_accrual(p_connection text, p_sender_tg bigint, p_customer uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c business_connections;
  a artists;
begin
  select * into c from business_connections where id = p_connection and is_enabled;
  if not found or c.user_telegram_id <> p_sender_tg then perform _fail('Бизнес-подключение не найдено'); end if;
  select ar.* into a from artists ar join users u on u.id = ar.user_id where u.telegram_id = p_sender_tg and ar.active;
  if not found then perform _fail('Начислять АРТы могут художники Артоки'); end if;
  insert into memberships (program_id, user_id, source) values (a.program_id, p_customer, 'business') on conflict do nothing;
  return _operation(a.id, p_customer, 'earn', p_amount, null, true, 'business', a.user_id, null);
end $$;

-------------------------------------------------------------------------------
-- Заявки художников
-------------------------------------------------------------------------------

create table public.artist_applications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users,
  about        text not null check (length(about) between 1 and 500),
  links        text not null default '' check (length(links) <= 500),
  desired      text not null default 'solo' check (length(desired) <= 40),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by  bigint,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create unique index artist_applications_pending_idx on public.artist_applications (user_id) where status = 'pending';
alter table public.artist_applications enable row level security;

create or replace function public._application_json(x public.artist_applications)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', x.id, 'about', x.about, 'links', x.links, 'desired', x.desired, 'status', x.status,
    'created_at', x.created_at, 'reviewed_at', x.reviewed_at,
    'user', (select jsonb_build_object('name', u.first_name, 'username', u.username, 'telegram_id', u.telegram_id)
             from users u where u.id = x.user_id))
$$;

create or replace function public.submit_application(p_user uuid, p_about text, p_links text, p_desired text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u users;
  x artist_applications;
  v_desired text := lower(btrim(coalesce(nullif(p_desired, ''), 'solo')));
begin
  select * into u from users where id = p_user;
  if exists (select 1 from artists where user_id = p_user) then perform _fail('Вы уже художник Артоки'); end if;
  if lower(coalesce(u.username, '')) !~ '^[a-z0-9_.]{2,32}$' then
    perform _fail('Чтобы стать художником, задайте username в настройках Telegram');
  end if;
  if exists (select 1 from artist_applications where user_id = p_user and status = 'pending') then
    perform _fail('Заявка уже отправлена, дождитесь ответа');
  end if;
  if length(btrim(coalesce(p_about, ''))) not between 1 and 500 then perform _fail('Расскажите о себе (до 500 символов)'); end if;
  if v_desired <> 'solo' and not exists (select 1 from programs where slug = v_desired and type = 'group') then
    perform _fail('Такой группы нет. Оставьте «solo» или укажите адрес группы.');
  end if;
  insert into artist_applications (user_id, about, links, desired)
  values (p_user, btrim(p_about), left(btrim(coalesce(p_links, '')), 500), v_desired) returning * into x;
  return _application_json(x);
end $$;

create or replace function public.my_application(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select _application_json(x) from artist_applications x where x.user_id = p_user order by x.created_at desc limit 1
$$;

create or replace function public.decide_application(p_admin_tg bigint, p_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  x artist_applications;
  r jsonb;
begin
  select * into x from artist_applications where id = p_id for update;
  if not found then perform _fail('Заявка не найдена'); end if;
  if x.status <> 'pending' then perform _fail('Заявка уже рассмотрена'); end if;
  if p_approve then
    r := accept_invite(x.user_id, create_invite(p_admin_tg, x.desired) ->> 'code');
  end if;
  update artist_applications set status = case when p_approve then 'approved' else 'rejected' end,
                                 reviewed_by = p_admin_tg, reviewed_at = now()
   where id = x.id returning * into x;
  return _application_json(x) || jsonb_build_object('program', r -> 'program');
end $$;

-------------------------------------------------------------------------------
-- Начисление/списание: сертификаты, акции, день рождения, «Приведи друга»
-------------------------------------------------------------------------------

create or replace function public._operation(
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
  bs jsonb;
  promo jsonb;
  v_mult numeric := 1;
  v_boost numeric := 0;
  v_spent bigint;
  v_bal bigint;
  v_pay_limit bigint := 0;
  v_foreign_cap bigint;
  v_g0 bigint := 0;   -- сертификаты без ограничений (свои и группы)
  v_gf bigint := 0;   -- сертификаты коллег (только лимит чужих)
  v_n0 bigint := 0;   -- обычные свои и бонусные (лимит уровня)
  v_nf bigint := 0;   -- обычные чужие (лимит уровня и лимит чужих)
  q1 bigint := 0; q2 bigint := 0; q3 bigint := 0; q4 bigint := 0;
  v_rem bigint;
  v_max bigint := 0;
  v_r bigint := 0;
  v_gift bigint := 0;
  v_paid bigint;
  v_earn bigint;
  v_entry uuid;
  v_take bigint;
  v_cat int;
  lot record;
  v_ref jsonb;
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
  promo := _active_promotion(a.id);
  if promo is not null then v_mult := (promo ->> 'multiplier')::numeric; end if;
  bs := _program_settings(a.program_id) -> 'birthday';
  if bs ->> 'mode' = 'boost' and _birthday_distance(m.id) <= (bs ->> 'window_days')::int then
    v_boost := (bs ->> 'boost_pct')::numeric;
  end if;

  if p_mode = 'redeem' then
    v_pay_limit := floor(p_amount * t.pay_pct / 100);
    select coalesce(sum(remaining) filter (where is_gift and (origin_artist_id is null or origin_artist_id = a.id)), 0),
           coalesce(sum(remaining) filter (where is_gift and origin_artist_id is not null and origin_artist_id <> a.id), 0),
           coalesce(sum(remaining) filter (where not is_gift and (origin_artist_id is null or origin_artist_id = a.id)), 0),
           coalesce(sum(remaining) filter (where not is_gift and origin_artist_id is not null and origin_artist_id <> a.id), 0)
      into v_g0, v_gf, v_n0, v_nf
      from point_lots
     where user_id = m.id and program_id = a.program_id and remaining > 0
       and (expires_at is null or expires_at > now());
    v_foreign_cap := case when a.foreign_mode = 'by_tier' then floor(p_amount * t.foreign_pct / 100) else v_gf + v_nf end;

    -- Сколько можно списать всего (жадно: сертификаты, затем обычные).
    q1 := least(p_amount, v_g0);
    q2 := least(p_amount - q1, v_gf, v_foreign_cap);
    q3 := least(p_amount - q1 - q2, v_n0, v_pay_limit);
    q4 := greatest(least(p_amount - q1 - q2 - q3, v_nf, v_foreign_cap - q2, v_pay_limit - q3), 0);
    v_max := q1 + q2 + q3 + q4;
    v_r := coalesce(least(p_redeem, v_max), v_max);

    -- Раскладка конкретной суммы v_r по тем же категориям.
    v_rem := v_r;
    q1 := least(v_rem, v_g0); v_rem := v_rem - q1;
    q2 := least(v_rem, v_gf, v_foreign_cap); v_rem := v_rem - q2;
    q3 := least(v_rem, v_n0, v_pay_limit); v_rem := v_rem - q3;
    q4 := greatest(least(v_rem, v_nf, v_foreign_cap - q2, v_pay_limit - q3), 0);
    v_gift := q1 + q2;
  end if;

  v_paid := p_amount - v_r;
  v_earn := floor(v_paid * (t.earn_pct + v_boost) / 100 * v_mult);
  nt := _tier_for(a.id, v_spent + v_paid + v_gift);

  result := jsonb_build_object(
    'mode', p_mode, 'amount', p_amount, 'redeem', v_r, 'max_redeem', v_max,
    'pay_limit', v_pay_limit,
    'foreign_cap', case when a.foreign_mode = 'by_tier' then v_foreign_cap end,
    'foreign_available', v_gf + v_nf, 'own_available', v_g0 + v_n0, 'gift_available', v_g0 + v_gf,
    'gift_used', v_gift,
    'paid', v_paid, 'earn', v_earn, 'points', v_earn - v_r,
    'multiplier', v_mult, 'promotion', promo, 'birthday_boost', v_boost,
    'balance_before', v_bal, 'balance_after', v_bal + v_earn - v_r,
    'spent_before', v_spent, 'spent_after', v_spent + v_paid + v_gift,
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

  insert into ledger_entries (program_id, user_id, artist_id, kind, order_amount, paid_amount, gift_redeemed, earned, redeemed,
                              points, tier_snapshot, source, created_by, order_id)
  values (a.program_id, m.id, a.id, case p_mode when 'earn' then 'accrual' else 'redeem' end,
          p_amount, v_paid, v_gift, v_earn, v_r, v_earn - v_r,
          (result -> 'tier') || jsonb_build_object('multiplier', v_mult, 'birthday_boost', v_boost),
          coalesce(p_source, 'cassa'), p_actor, o.id)
  returning id into v_entry;

  if v_r > 0 then
    for lot in
      select *, case when is_gift and (origin_artist_id is null or origin_artist_id = a.id) then 1
                     when is_gift then 2
                     when origin_artist_id is null or origin_artist_id = a.id then 3
                     else 4 end as cat
        from point_lots
       where user_id = m.id and program_id = a.program_id and remaining > 0
         and (expires_at is null or expires_at > now())
       order by cat, (expires_at is null), expires_at, created_at
       for update
    loop
      v_cat := lot.cat;
      v_take := least(lot.remaining, case v_cat when 1 then q1 when 2 then q2 when 3 then q3 else q4 end);
      continue when v_take <= 0;
      update point_lots set remaining = remaining - v_take where id = lot.id;
      insert into lot_spends (entry_id, lot_id, amount) values (v_entry, lot.id, v_take);
      if v_cat = 1 then q1 := q1 - v_take; elsif v_cat = 2 then q2 := q2 - v_take;
      elsif v_cat = 3 then q3 := q3 - v_take; else q4 := q4 - v_take; end if;
    end loop;
    if q1 + q2 + q3 + q4 > 0 then perform _fail('Недостаточно АРТов'); end if;
  end if;

  if v_earn > 0 then
    insert into point_lots (entry_id, program_id, user_id, origin_artist_id, amount, remaining, expires_at)
    values (v_entry, a.program_id, m.id, a.id, v_earn, v_earn,
            case when a.points_ttl_days is not null then now() + make_interval(days => a.points_ttl_days) end);
  end if;
  if o.id is not null then
    update orders set updated_at = now() where id = o.id;
  end if;

  v_ref := _referral_reward(m.id, a.program_id, v_paid + v_gift);

  return result || jsonb_build_object('entry_id', v_entry, 'balance_after', _balance(m.id, a.program_id), 'referral', v_ref);
end $$;

-------------------------------------------------------------------------------
-- Экраны: кошелёк, карточка художника, настройки художника
-------------------------------------------------------------------------------

create or replace function public.get_me(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'name', u.first_name, 'username', u.username, 'code', u.member_code,
                               'birth_day', u.birth_day, 'birth_month', u.birth_month,
                               'has_referrer', exists (select 1 from referrals r where r.referee_id = u.id)),
    'artist', (select _artist_json(a) || jsonb_build_object('program', program_info(a.program_id))
               from artists a where a.user_id = u.id and a.active),
    'programs', coalesce((
      select jsonb_agg(
        program_info(m.program_id) || jsonb_build_object(
          'balance', _balance(u.id, m.program_id),
          'tiers', (select coalesce(jsonb_object_agg(a.id, _tier_json(u.id, a.id)), '{}'::jsonb)
                    from artists a where a.program_id = m.program_id and a.active),
          'fundraiser', (select _fundraiser_json(f) from fundraisers f where f.program_id = m.program_id and f.status = 'active'))
        order by m.joined_at)
      from memberships m where m.user_id = u.id), '[]'::jsonb))
  from users u where u.id = p_user
$$;

create or replace function public.get_artist_card(p_user uuid, p_artist uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists;
begin
  select * into a from artists where id = p_artist and active;
  if not found then perform _fail('Художник не найден'); end if;
  return jsonb_build_object(
    'artist', _artist_json(a) || jsonb_build_object('donate_links', a.donate_links, 'donation_earn_pct', a.donation_earn_pct),
    'program', (select jsonb_build_object('id', p.id, 'name', p.name, 'type', p.type) from programs p where p.id = a.program_id),
    'tiers', (select jsonb_agg(jsonb_build_object('index', t.sort, 'name', t.name, 'min_spent', t.min_spent,
                'earn_pct', t.earn_pct, 'pay_pct', t.pay_pct, 'foreign_pct', t.foreign_pct, 'perks', t.perks,
                'early_hours', t.early_hours) order by t.sort)
              from tiers t where t.artist_id = a.id),
    'my_tier', _tier_json(p_user, a.id),
    'slots', _slots_info(a.id, p_user),
    'promotion', _active_promotion(a.id),
    'is_member', exists (select 1 from memberships where program_id = a.program_id and user_id = p_user),
    'history', coalesce((select jsonb_agg(_entry_json(e) order by e.created_at desc)
                         from ledger_entries e where e.user_id = p_user and e.artist_id = a.id and e.kind <> 'reversal'), '[]'::jsonb));
end $$;

create or replace function public.get_artist_settings(p_artist_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  return jsonb_build_object(
    'artist', _artist_json(a) || jsonb_build_object('order_stages', to_jsonb(a.order_stages), 'slots_total', a.slots_total,
                                                    'donate_links', a.donate_links, 'donation_earn_pct', a.donation_earn_pct),
    'program', program_info(a.program_id),
    'slots', _slots_info(a.id, null),
    'tiers', (select jsonb_agg(jsonb_build_object('name', t.name, 'min_spent', t.min_spent, 'earn_pct', t.earn_pct,
               'pay_pct', t.pay_pct, 'foreign_pct', t.foreign_pct, 'perks', t.perks, 'early_hours', t.early_hours) order by t.sort)
              from tiers t where t.artist_id = a.id));
end $$;

-- Уровни теперь с ранним доступом к слотам.
create or replace function public.save_artist_settings(p_artist_user uuid, p_tiers jsonb, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  v_count int := jsonb_array_length(coalesce(p_tiers, '[]'::jsonb));
  v_prev bigint := -1;
  t jsonb;
  i int := 0;
  v_name text;
  v_min bigint;
begin
  if v_count < 1 or v_count > 5 then perform _fail('Уровней должно быть от 1 до 5'); end if;
  for t in select * from jsonb_array_elements(p_tiers) loop
    v_name := btrim(coalesce(t ->> 'name', ''));
    v_min := case when i = 0 then 0 else (t ->> 'min_spent')::bigint end;
    if v_name = '' then perform _fail(format('У уровня %s нет названия', i + 1)); end if;
    if v_min <= v_prev then perform _fail(format('Порог уровня «%s» должен быть больше предыдущего', v_name)); end if;
    if coalesce((t ->> 'earn_pct')::numeric, -1) not between 0 and 100
       or coalesce((t ->> 'pay_pct')::numeric, -1) not between 0 and 100
       or coalesce((t ->> 'foreign_pct')::numeric, 0) not between 0 and 100 then
      perform _fail(format('Проценты уровня «%s» должны быть от 0 до 100', v_name));
    end if;
    if coalesce((t ->> 'early_hours')::numeric, 0) not between 0 and 168 then
      perform _fail(format('Ранний доступ уровня «%s» — от 0 до 168 часов', v_name));
    end if;
    v_prev := v_min;
    i := i + 1;
  end loop;

  delete from tiers where artist_id = a.id;
  i := 0;
  for t in select * from jsonb_array_elements(p_tiers) loop
    insert into tiers (artist_id, sort, name, min_spent, earn_pct, pay_pct, foreign_pct, perks, early_hours)
    values (a.id, i, btrim(t ->> 'name'), case when i = 0 then 0 else (t ->> 'min_spent')::bigint end,
            (t ->> 'earn_pct')::numeric, (t ->> 'pay_pct')::numeric, coalesce((t ->> 'foreign_pct')::numeric, 0),
            coalesce(t ->> 'perks', ''), coalesce((t ->> 'early_hours')::int, 0));
    i := i + 1;
  end loop;

  if p_settings ? 'foreign_mode' then
    update artists set foreign_mode = p_settings ->> 'foreign_mode' where id = a.id;
  end if;
  if p_settings ? 'points_ttl_days' then
    update artists set points_ttl_days = nullif(p_settings ->> 'points_ttl_days', '')::int where id = a.id;
  end if;
  if p_settings ? 'bio' then
    update artists set bio = left(coalesce(p_settings ->> 'bio', ''), 200) where id = a.id;
  end if;
  if p_settings ? 'display_name' then
    update artists set display_name = left(coalesce(p_settings ->> 'display_name', ''), 64) where id = a.id;
  end if;
  return get_artist_settings(p_artist_user);
end $$;

-------------------------------------------------------------------------------
-- Секрет для вызова функций по расписанию
-------------------------------------------------------------------------------

create table public.app_secrets (
  key    text primary key,
  value  text not null
);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (key, value)
values ('cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function public.check_cron_secret(p_secret text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_secrets where key = 'cron' and value = p_secret and length(p_secret) >= 32)
$$;

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
