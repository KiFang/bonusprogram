-- Артоки: базовая схема MVP.
-- Доступ к данным только через edge-функции (service_role). RLS включён на всех
-- таблицах без политик, поэтому anon/authenticated ничего не видят напрямую.

-------------------------------------------------------------------------------
-- Таблицы
-------------------------------------------------------------------------------

create table public.users (
  id            uuid primary key default gen_random_uuid(),
  telegram_id   bigint not null unique,
  username      text,
  first_name    text not null default '',
  last_name     text,
  member_code   text not null unique,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create table public.programs (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('group', 'solo')),
  name        text not null check (length(name) between 1 and 64),
  slug        text not null unique check (slug ~ '^[a-z0-9_.]{2,32}$'),
  created_at  timestamptz not null default now()
);

create table public.artists (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references public.users on delete cascade,
  program_id       uuid not null references public.programs,
  nick             text not null unique check (nick ~ '^[a-z0-9_.]{2,32}$'),
  display_name     text not null default '',
  bio              text not null default '' check (length(bio) <= 200),
  color            text not null default '#E0B252' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  foreign_mode     text not null default 'unlimited' check (foreign_mode in ('unlimited', 'by_tier')),
  points_ttl_days  int check (points_ttl_days between 1 and 3650),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index artists_program_idx on public.artists (program_id);

create table public.tiers (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references public.artists on delete cascade,
  sort         int not null check (sort between 0 and 9),
  name         text not null check (length(name) between 1 and 32),
  min_spent    bigint not null check (min_spent >= 0),
  earn_pct     numeric(5,2) not null check (earn_pct between 0 and 100),
  pay_pct      numeric(5,2) not null check (pay_pct between 0 and 100),
  foreign_pct  numeric(5,2) not null default 0 check (foreign_pct between 0 and 100),
  perks        text not null default '' check (length(perks) <= 300),
  unique (artist_id, sort)
);

create table public.memberships (
  program_id  uuid not null references public.programs on delete cascade,
  user_id     uuid not null references public.users on delete cascade,
  source      text not null default 'command',
  joined_at   timestamptz not null default now(),
  primary key (program_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- Журнал операций: только дополняется. Отмена = запись kind='reversal'.
create table public.ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references public.programs,
  user_id        uuid not null references public.users,
  artist_id      uuid references public.artists,
  kind           text not null check (kind in ('accrual', 'redeem', 'bonus', 'reversal')),
  order_amount   bigint not null default 0,
  paid_amount    bigint not null default 0,
  earned         bigint not null default 0,
  redeemed       bigint not null default 0,
  points         bigint not null,
  tier_snapshot  jsonb,
  source         text not null default 'cassa',
  reverses_id    uuid unique references public.ledger_entries,
  created_by     uuid references public.users,
  created_at     timestamptz not null default now()
);
create index ledger_user_program_idx on public.ledger_entries (user_id, program_id, created_at desc);
create index ledger_artist_idx on public.ledger_entries (artist_id, created_at desc);

-- «Пачки» АРТов: откуда пришли, сколько осталось, когда сгорают.
create table public.point_lots (
  id                uuid primary key default gen_random_uuid(),
  entry_id          uuid not null references public.ledger_entries,
  program_id        uuid not null references public.programs,
  user_id           uuid not null references public.users,
  origin_artist_id  uuid references public.artists,
  amount            bigint not null check (amount > 0),
  remaining         bigint not null check (remaining >= 0 and remaining <= amount),
  expires_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index point_lots_wallet_idx on public.point_lots (user_id, program_id) where remaining > 0;
create index point_lots_entry_idx on public.point_lots (entry_id);

create table public.lot_spends (
  entry_id  uuid not null references public.ledger_entries,
  lot_id    uuid not null references public.point_lots,
  amount    bigint not null check (amount > 0),
  primary key (entry_id, lot_id)
);

-- Одноразовые inline-начисления: одно сообщение = одно начисление.
create table public.inline_claims (
  ref         text primary key,
  entry_id    uuid references public.ledger_entries,
  created_at  timestamptz not null default now()
);

create table public.invites (
  code        text primary key,
  program_id  uuid references public.programs,  -- null = новый соло-художник
  created_by  bigint not null,                  -- telegram_id админа
  used_by     uuid references public.users,
  used_at     timestamptz,
  expires_at  timestamptz not null default now() + interval '14 days',
  created_at  timestamptz not null default now()
);

alter table public.users          enable row level security;
alter table public.programs       enable row level security;
alter table public.artists        enable row level security;
alter table public.tiers          enable row level security;
alter table public.memberships    enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.point_lots     enable row level security;
alter table public.lot_spends     enable row level security;
alter table public.inline_claims  enable row level security;
alter table public.invites        enable row level security;

-------------------------------------------------------------------------------
-- Внутренние помощники
-------------------------------------------------------------------------------

create or replace function public._fail(p_message text)
returns void language plpgsql as $$
begin
  raise exception using message = p_message, errcode = 'P0001';
end $$;

create or replace function public._norm(p text)
returns text language sql immutable as $$
  select replace(lower(btrim(regexp_replace(coalesce(p, ''), '[@«»"'']', '', 'g'))), 'ё', 'е')
$$;

create or replace function public._gen_code(p_prefix text, p_len int)
returns text language plpgsql as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  result text := p_prefix;
begin
  for i in 1..p_len loop
    result := result || substr(alphabet, 1 + floor(random() * 32)::int, 1);
  end loop;
  return result;
end $$;

create or replace function public._is_reversed(p_entry uuid)
returns boolean language sql stable as $$
  select exists (select 1 from public.ledger_entries r where r.reverses_id = p_entry)
$$;

-- Сколько клиент заплатил деньгами этому художнику (для уровня).
create or replace function public._spent(p_user uuid, p_artist uuid)
returns bigint language sql stable as $$
  select coalesce(sum(e.paid_amount), 0)::bigint
  from public.ledger_entries e
  where e.user_id = p_user and e.artist_id = p_artist
    and e.kind in ('accrual', 'redeem')
    and not public._is_reversed(e.id)
$$;

create or replace function public._balance(p_user uuid, p_program uuid)
returns bigint language sql stable as $$
  select coalesce(sum(remaining), 0)::bigint
  from public.point_lots
  where user_id = p_user and program_id = p_program and remaining > 0
    and (expires_at is null or expires_at > now())
$$;

create or replace function public._tier_for(p_artist uuid, p_spent bigint)
returns public.tiers language sql stable as $$
  select t.* from public.tiers t
  where t.artist_id = p_artist and t.min_spent <= p_spent
  order by t.sort desc limit 1
$$;

create or replace function public._tier_json(p_user uuid, p_artist uuid)
returns jsonb language plpgsql stable as $$
declare
  v_spent bigint := public._spent(p_user, p_artist);
  t public.tiers := public._tier_for(p_artist, v_spent);
  n public.tiers;
  v_count int;
  v_progress int := 100;
begin
  select count(*) into v_count from public.tiers where artist_id = p_artist;
  select * into n from public.tiers where artist_id = p_artist and sort > t.sort order by sort limit 1;
  if n.id is not null then
    v_progress := greatest(0, least(100, floor((v_spent - t.min_spent) * 100.0 / nullif(n.min_spent - t.min_spent, 0))))::int;
  end if;
  return jsonb_build_object(
    'index', t.sort, 'count', v_count, 'name', t.name,
    'earn_pct', t.earn_pct, 'pay_pct', t.pay_pct, 'foreign_pct', t.foreign_pct, 'perks', t.perks,
    'spent', v_spent, 'progress', v_progress,
    'next', case when n.id is null then null
                 else jsonb_build_object('name', n.name, 'min_spent', n.min_spent) end
  );
end $$;

create or replace function public._artist_json(a public.artists)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', a.id, 'nick', a.nick, 'display_name', a.display_name, 'bio', a.bio,
    'color', a.color, 'foreign_mode', a.foreign_mode, 'points_ttl_days', a.points_ttl_days,
    'program_id', a.program_id)
$$;

create or replace function public._default_tiers(p_artist uuid)
returns void language sql as $$
  insert into public.tiers (artist_id, sort, name, min_spent, earn_pct, pay_pct, foreign_pct, perks) values
    (p_artist, 0, 'Эскиз',  0,     3, 20, 10, 'Базовый уровень с первого заказа'),
    (p_artist, 1, 'Холст',  10000, 5, 30, 15, 'Приоритет в очереди'),
    (p_artist, 2, 'Шедевр', 30000, 8, 50, 25, 'Ранний доступ к слотам')
$$;

-------------------------------------------------------------------------------
-- Пользователи и программы
-------------------------------------------------------------------------------

create or replace function public.upsert_user(p_telegram_id bigint, p_username text, p_first_name text, p_last_name text)
returns public.users language plpgsql security definer set search_path = public as $$
declare
  u public.users;
begin
  update users set username = p_username, first_name = coalesce(p_first_name, ''), last_name = p_last_name, last_seen_at = now()
  where telegram_id = p_telegram_id returning * into u;
  if found then return u; end if;
  loop
    begin
      insert into users (telegram_id, username, first_name, last_name, member_code)
      values (p_telegram_id, p_username, coalesce(p_first_name, ''), p_last_name, _gen_code('KF-', 4))
      returning * into u;
      return u;
    exception when unique_violation then
      select * into u from users where telegram_id = p_telegram_id;
      if found then return u; end if;
    end;
  end loop;
end $$;

create or replace function public.resolve_program(p_query text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.id from programs p where p.slug = _norm(p_query) or _norm(p.name) = _norm(p_query) limit 1),
    (select a.program_id from artists a where a.nick = _norm(p_query) and a.active limit 1))
$$;

create or replace function public.program_info(p_program uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'type', p.type, 'slug', p.slug,
    'artists', coalesce((select jsonb_agg(_artist_json(a) order by a.created_at)
                         from artists a where a.program_id = p.id and a.active), '[]'::jsonb))
  from programs p where p.id = p_program
$$;

create or replace function public.join_program(p_user uuid, p_program uuid, p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_new int;
begin
  if not exists (select 1 from programs where id = p_program) then
    perform _fail('Программа не найдена');
  end if;
  insert into memberships (program_id, user_id, source) values (p_program, p_user, coalesce(p_source, 'command'))
  on conflict do nothing;
  get diagnostics v_new = row_count;
  return jsonb_build_object('joined', v_new > 0, 'program', program_info(p_program),
                            'balance', _balance(p_user, p_program));
end $$;

-------------------------------------------------------------------------------
-- Экраны участника
-------------------------------------------------------------------------------

create or replace function public.get_me(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'name', u.first_name, 'username', u.username, 'code', u.member_code),
    'artist', (select _artist_json(a) || jsonb_build_object('program', program_info(a.program_id))
               from artists a where a.user_id = u.id and a.active),
    'programs', coalesce((
      select jsonb_agg(
        program_info(m.program_id) || jsonb_build_object(
          'balance', _balance(u.id, m.program_id),
          'tiers', (select coalesce(jsonb_object_agg(a.id, _tier_json(u.id, a.id)), '{}'::jsonb)
                    from artists a where a.program_id = m.program_id and a.active))
        order by m.joined_at)
      from memberships m where m.user_id = u.id), '[]'::jsonb))
  from users u where u.id = p_user
$$;

create or replace function public._entry_json(e public.ledger_entries)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'order_amount', e.order_amount, 'paid_amount', e.paid_amount,
    'earned', e.earned, 'redeemed', e.redeemed, 'points', e.points, 'tier', e.tier_snapshot,
    'source', e.source, 'created_at', e.created_at, 'reversed', public._is_reversed(e.id),
    'artist_nick', (select a.nick from public.artists a where a.id = e.artist_id))
$$;

create or replace function public.get_artist_card(p_user uuid, p_artist uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists;
begin
  select * into a from artists where id = p_artist and active;
  if not found then perform _fail('Художник не найден'); end if;
  return jsonb_build_object(
    'artist', _artist_json(a),
    'program', (select jsonb_build_object('id', p.id, 'name', p.name, 'type', p.type) from programs p where p.id = a.program_id),
    'tiers', (select jsonb_agg(jsonb_build_object('index', t.sort, 'name', t.name, 'min_spent', t.min_spent,
                'earn_pct', t.earn_pct, 'pay_pct', t.pay_pct, 'foreign_pct', t.foreign_pct, 'perks', t.perks) order by t.sort)
              from tiers t where t.artist_id = a.id),
    'my_tier', _tier_json(p_user, a.id),
    'history', coalesce((select jsonb_agg(_entry_json(e) order by e.created_at desc)
                         from ledger_entries e where e.user_id = p_user and e.artist_id = a.id and e.kind <> 'reversal'), '[]'::jsonb));
end $$;

create or replace function public.get_program_history(p_user uuid, p_program uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'program', program_info(p_program),
    'balance', _balance(p_user, p_program),
    'history', coalesce((select jsonb_agg(_entry_json(e) order by e.created_at desc)
                         from ledger_entries e
                         where e.id in (select id from ledger_entries
                                        where user_id = p_user and program_id = p_program and kind <> 'reversal'
                                        order by created_at desc limit 200)), '[]'::jsonb))
$$;

-------------------------------------------------------------------------------
-- Начисление и списание
-------------------------------------------------------------------------------

create or replace function public._operation(
  p_artist uuid, p_member uuid, p_mode text, p_amount bigint, p_redeem bigint,
  p_commit boolean, p_source text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists;
  m users;
  p programs;
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
    'program', jsonb_build_object('id', p.id, 'name', p.name, 'type', p.type));

  if not p_commit then return result; end if;

  if p_redeem is not null and p_redeem > v_max then
    perform _fail(format('Можно списать не больше %s АРТ', v_max));
  end if;
  if p_mode = 'redeem' and v_r <= 0 then perform _fail('Нечего списать'); end if;

  insert into ledger_entries (program_id, user_id, artist_id, kind, order_amount, paid_amount, earned, redeemed, points,
                              tier_snapshot, source, created_by)
  values (a.program_id, m.id, a.id, case p_mode when 'earn' then 'accrual' else 'redeem' end,
          p_amount, v_paid, v_earn, v_r, v_earn - v_r, result -> 'tier', coalesce(p_source, 'cassa'), p_actor)
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

  return result || jsonb_build_object('entry_id', v_entry, 'balance_after', _balance(m.id, a.program_id));
end $$;

create or replace function public._artist_by_user(p_user uuid)
returns public.artists language plpgsql stable security definer set search_path = public as $$
declare
  a artists;
begin
  select * into a from artists where user_id = p_user and active;
  if not found then perform _fail('Эта функция доступна только художникам'); end if;
  return a;
end $$;

create or replace function public.find_member(p_code text)
returns public.users language plpgsql stable security definer set search_path = public as $$
declare
  u users;
begin
  select * into u from users where member_code = upper(btrim(p_code));
  if not found then perform _fail(format('Код «%s» не найден', upper(btrim(p_code)))); end if;
  return u;
end $$;

create or replace function public.quote_operation(p_artist_user uuid, p_member_code text, p_mode text, p_amount bigint, p_redeem bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return _operation((_artist_by_user(p_artist_user)).id, (find_member(p_member_code)).id,
                    p_mode, p_amount, p_redeem, false, 'cassa', p_artist_user);
end $$;

create or replace function public.commit_operation(p_artist_user uuid, p_member_code text, p_mode text, p_amount bigint, p_redeem bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return _operation((_artist_by_user(p_artist_user)).id, (find_member(p_member_code)).id,
                    p_mode, p_amount, p_redeem, true, 'cassa', p_artist_user);
end $$;

-- Клиент нажал «Забрать АРТы» под inline-сообщением художника.
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
  v_result := _operation(a.id, p_member, 'earn', p_amount, null, true, 'inline', a.user_id);
  update inline_claims set entry_id = (v_result ->> 'entry_id')::uuid where ref = p_ref;
  return v_result;
end $$;

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
-- Экраны художника
-------------------------------------------------------------------------------

create or replace function public.artist_operations(p_artist_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  return jsonb_build_object(
    'paid_total', (select coalesce(sum(paid_amount), 0) from ledger_entries e
                   where e.artist_id = a.id and e.kind in ('accrual', 'redeem') and not _is_reversed(e.id)),
    'items', coalesce((
      select jsonb_agg(_entry_json(e) || jsonb_build_object(
               'member', jsonb_build_object('name', u.first_name, 'code', u.member_code),
               'can_cancel', not _is_reversed(e.id) and e.created_at > now() - interval '24 hours')
             order by e.created_at desc)
      from ledger_entries e join users u on u.id = e.user_id
      where e.id in (select id from ledger_entries where artist_id = a.id and kind in ('accrual', 'redeem')
                     order by created_at desc limit 100)), '[]'::jsonb));
end $$;

create or replace function public.artist_clients(p_artist_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'name', u.first_name, 'code', u.member_code, 'username', u.username,
             'tier', _tier_json(u.id, a.id), 'balance', _balance(u.id, a.program_id))
           order by public._spent(u.id, a.id) desc, m.joined_at)
    from memberships m join users u on u.id = m.user_id
    where m.program_id = a.program_id and u.id <> a.user_id), '[]'::jsonb);
end $$;

create or replace function public.get_artist_settings(p_artist_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
begin
  return jsonb_build_object(
    'artist', _artist_json(a),
    'program', program_info(a.program_id),
    'tiers', (select jsonb_agg(jsonb_build_object('name', t.name, 'min_spent', t.min_spent, 'earn_pct', t.earn_pct,
               'pay_pct', t.pay_pct, 'foreign_pct', t.foreign_pct, 'perks', t.perks) order by t.sort)
              from tiers t where t.artist_id = a.id));
end $$;

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
    v_prev := v_min;
    i := i + 1;
  end loop;

  delete from tiers where artist_id = a.id;
  i := 0;
  for t in select * from jsonb_array_elements(p_tiers) loop
    insert into tiers (artist_id, sort, name, min_spent, earn_pct, pay_pct, foreign_pct, perks)
    values (a.id, i, btrim(t ->> 'name'), case when i = 0 then 0 else (t ->> 'min_spent')::bigint end,
            (t ->> 'earn_pct')::numeric, (t ->> 'pay_pct')::numeric, coalesce((t ->> 'foreign_pct')::numeric, 0),
            coalesce(t ->> 'perks', ''));
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
-- Администрирование: группы и приглашения художников
-------------------------------------------------------------------------------

create or replace function public.create_group(p_name text, p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into programs (type, name, slug) values ('group', btrim(p_name), lower(btrim(p_slug))) returning id into v_id;
  return program_info(v_id);
exception when unique_violation then
  perform _fail('Такой адрес группы уже занят');
end $$;

create or replace function public.create_invite(p_admin_tg bigint, p_program_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_program uuid;
  v_code text;
begin
  if p_program_slug is not null and lower(p_program_slug) <> 'solo' then
    select id into v_program from programs where slug = lower(btrim(p_program_slug)) and type = 'group';
    if v_program is null then perform _fail('Группа не найдена'); end if;
  end if;
  loop
    v_code := _gen_code('', 8);
    begin
      insert into invites (code, program_id, created_by) values (v_code, v_program, p_admin_tg);
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;
  return jsonb_build_object('code', v_code, 'program', case when v_program is not null then program_info(v_program) end);
end $$;

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

  insert into artists (user_id, program_id, nick, display_name) values (u.id, v_program, v_nick, u.first_name)
  returning id into v_artist;
  perform _default_tiers(v_artist);
  update invites set used_by = u.id, used_at = now() where code = inv.code;
  return jsonb_build_object('artist_id', v_artist, 'program', program_info(v_program));
end $$;

-------------------------------------------------------------------------------
-- Права: функции вызываются только сервером (service_role)
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
