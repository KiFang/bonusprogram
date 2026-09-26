-- Художник не может быть участником программы, в которой сам работает (своей группы или соло),
-- иначе он мог бы начислять АРТы себе через коллег, сертификаты или донаты.
-- Плюс флаги мини-обучения для участника и художника.

create or replace function public._is_artist_in(p_user uuid, p_program uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from artists where user_id = p_user and program_id = p_program and active)
$$;

-- Единая точка запрета: любой путь, который создаёт участие (вступление, кнопка в чате,
-- сертификат, донат, /addart), упирается в этот триггер.
create or replace function public._membership_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if _is_artist_in(new.user_id, new.program_id) then
    perform _fail('Художник не может быть участником программы своей группы');
  end if;
  return new;
end $$;

create trigger memberships_artist_guard before insert on public.memberships
  for each row execute function public._membership_guard();

-- Снять участие: сжечь остаток, закрыть пачки, отозвать заявки на слоты, удалить участие.
create or replace function public._drop_membership(p_user uuid, p_program uuid, p_actor uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_bal bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_program::text || p_user::text, 0));
  v_bal := _balance(p_user, p_program);
  if v_bal > 0 then
    insert into ledger_entries (program_id, user_id, kind, points, source, created_by)
    values (p_program, p_user, 'forfeit', -v_bal, 'app', p_actor);
  end if;
  update point_lots set remaining = 0 where user_id = p_user and program_id = p_program and remaining > 0;
  update slot_requests r set status = 'withdrawn', decided_at = now()
    from artists a
   where a.id = r.artist_id and a.program_id = p_program and r.user_id = p_user and r.status = 'pending';
  delete from memberships where program_id = p_program and user_id = p_user;
  return greatest(v_bal, 0);
end $$;

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
  v_bal := _drop_membership(p_user, p_program, p_user);
  return jsonb_build_object('program', jsonb_build_object('id', p.id, 'name', p.name), 'forfeited', v_bal);
end $$;

-- Став художником программы, человек перестаёт быть её участником (АРТы в ней сгорают).
create or replace function public.accept_invite(p_user uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv invites;
  u users;
  v_nick text;
  v_program uuid;
  v_artist uuid;
  v_forfeit bigint := 0;
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

  if exists (select 1 from memberships where program_id = v_program and user_id = u.id) then
    v_forfeit := _drop_membership(u.id, v_program, u.id);
  end if;

  insert into artists (user_id, program_id, nick, display_name, is_group_admin)
  values (u.id, v_program, v_nick, u.first_name, not exists (select 1 from artists where program_id = v_program))
  returning id into v_artist;
  perform _default_tiers(v_artist);
  update invites set used_by = u.id, used_at = now() where code = inv.code;
  return jsonb_build_object('artist_id', v_artist, 'program', program_info(v_program), 'forfeited', v_forfeit);
end $$;

-- Художник, пригласивший друга в свою же программу, награду в ней не получает.
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
  if _is_artist_in(r.referrer_id, p_program) then v_ref := 0; end if;
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

-- Уже существующие участия художников в своих программах снимаем.
do $$
declare
  x record;
begin
  for x in select m.user_id, m.program_id from memberships m where _is_artist_in(m.user_id, m.program_id) loop
    perform _drop_membership(x.user_id, x.program_id, null);
  end loop;
end $$;

-------------------------------------------------------------------------------
-- Мини-обучение
-------------------------------------------------------------------------------

alter table public.users
  add column onboarded_member_at timestamptz,
  add column onboarded_artist_at timestamptz;

create or replace function public.set_onboarded(p_user uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_role = 'member' then
    update users set onboarded_member_at = coalesce(onboarded_member_at, now()) where id = p_user;
  elsif p_role = 'artist' then
    update users set onboarded_artist_at = coalesce(onboarded_artist_at, now()) where id = p_user;
  else
    perform _fail('Неизвестная роль');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.get_me(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'name', u.first_name, 'username', u.username, 'code', u.member_code,
                               'birth_day', u.birth_day, 'birth_month', u.birth_month,
                               'has_referrer', exists (select 1 from referrals r where r.referee_id = u.id)),
    'onboarded', jsonb_build_object('member', u.onboarded_member_at is not null,
                                    'artist', u.onboarded_artist_at is not null),
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

revoke all on function public._is_artist_in(uuid, uuid), public._membership_guard(), public._drop_membership(uuid, uuid, uuid),
  public.leave_program(uuid, uuid), public.accept_invite(uuid, text), public._referral_reward(uuid, uuid, bigint),
  public.set_onboarded(uuid, text), public.get_me(uuid)
  from public, anon, authenticated;
grant execute on function public._is_artist_in(uuid, uuid), public._drop_membership(uuid, uuid, uuid),
  public.leave_program(uuid, uuid), public.accept_invite(uuid, text), public._referral_reward(uuid, uuid, bigint),
  public.set_onboarded(uuid, text), public.get_me(uuid)
  to service_role;
