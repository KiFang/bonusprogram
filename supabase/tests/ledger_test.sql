-- Проверки логики начисления и списания.
-- Запуск: supabase/tests/run.sh (поднимает временный Postgres и применяет миграции).
\set ON_ERROR_STOP on

create or replace function pg_temp.eq(actual anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: ожидали %, получили %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.fails(sql text, needle text, label text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL %: ошибки не было', label;
exception when others then
  if sqlerrm like 'FAIL %' then raise; end if;
  if position(needle in sqlerrm) = 0 then
    raise exception 'FAIL %: другая ошибка: %', label, sqlerrm;
  end if;
  raise notice 'ok  % (%)', label, sqlerrm;
end $$;

do $$
declare
  ink_u uuid := (upsert_user(101, 'InkFox', 'Инк', null)).id;
  shiro_u uuid := (upsert_user(102, 'shiro', 'Широ', null)).id;
  kira users := upsert_user(201, 'kira', 'Кира', null);
  dima users := upsert_user(202, null, 'Дима', null);
  ink uuid; shiro uuid; grp uuid; r jsonb; inv text; e uuid; e2 uuid;
begin
  perform pg_temp.eq(kira.member_code ~ '^KF-[2-9A-Z]{4}$', true, 'формат кода участника');
  perform pg_temp.eq((upsert_user(201, 'kira2', 'Кира', null)).member_code, kira.member_code, 'повторный вход сохраняет код');

  grp := (create_group('Полночь', 'polnoch') ->> 'id')::uuid;
  inv := create_invite(1, 'polnoch') ->> 'code';
  ink := (accept_invite(ink_u, inv) ->> 'artist_id')::uuid;
  perform pg_temp.fails(format('select accept_invite(%L, %L)', shiro_u, inv), 'уже использовано', 'инвайт одноразовый');
  shiro := (accept_invite(shiro_u, create_invite(1, 'polnoch') ->> 'code') ->> 'artist_id')::uuid;
  perform pg_temp.eq((select nick from artists where id = ink), 'inkfox', 'ник из username в нижнем регистре');
  perform pg_temp.fails(format('select accept_invite(%L, %L)', dima.id, create_invite(1, null) ->> 'code'), 'username', 'без username художником не стать');

  -- вступление
  perform pg_temp.eq(resolve_program('«Полночь»'), grp, 'поиск группы по названию');
  perform pg_temp.eq(resolve_program('@InkFox'), grp, 'поиск группы по нику художника');
  perform pg_temp.fails(format('select commit_operation(%L, %L, ''earn'', 1000, null)', ink_u, kira.member_code), 'ещё не в программе', 'нельзя начислить не участнику');
  perform pg_temp.eq((join_program(kira.id, grp, 'link') ->> 'joined')::boolean, true, 'вступление');
  perform pg_temp.eq((join_program(kira.id, grp, 'link') ->> 'joined')::boolean, false, 'повторное вступление');

  -- начисления: Эскиз 3%
  r := commit_operation(ink_u, lower(kira.member_code), 'earn', 7000, null);
  perform pg_temp.eq((r ->> 'earn')::int, 210, 'inkfox: 7000 ₽ × 3%');
  r := commit_operation(shiro_u, kira.member_code, 'earn', 12000, null);
  perform pg_temp.eq((r ->> 'earn')::int, 360, 'shiro: 12000 ₽ × 3%');
  perform pg_temp.eq((r ->> 'tier_up')::boolean, true, 'shiro: переход на Холст');
  perform pg_temp.eq(_balance(kira.id, grp), 570::bigint, 'общий баланс группы');

  -- списание у inkfox в режиме by_tier: Эскиз, оплата 20%, чужие 10%
  perform save_artist_settings(ink_u, (get_artist_settings(ink_u) -> 'tiers'), '{"foreign_mode":"by_tier"}');
  r := quote_operation(ink_u, kira.member_code, 'redeem', 6000, null);
  perform pg_temp.eq((r ->> 'pay_limit')::int, 1200, 'лимит оплаты 20%');
  perform pg_temp.eq((r ->> 'foreign_cap')::int, 600, 'лимит чужих 10%');
  perform pg_temp.eq((r ->> 'max_redeem')::int, 570, 'максимум = свои 210 + чужие 360');
  r := commit_operation(ink_u, kira.member_code, 'redeem', 6000, null);
  perform pg_temp.eq((r ->> 'paid')::int, 5430, 'доплата деньгами');
  perform pg_temp.eq((r ->> 'earn')::int, 162, 'начисление только на доплату');
  perform pg_temp.eq(_balance(kira.id, grp), 162::bigint, 'баланс после списания');
  perform pg_temp.eq(_spent(kira.id, ink), 12430::bigint, 'в уровень идут только деньги');

  -- лимит чужих АРТов действительно ограничивает
  perform commit_operation(shiro_u, kira.member_code, 'earn', 20000, null);  -- Холст 5% → 1000
  r := quote_operation(ink_u, kira.member_code, 'redeem', 3000, null);       -- inkfox: Холст, 30% / чужие 15%
  perform pg_temp.eq((r ->> 'max_redeem')::int, 612, 'свои 162 + чужие до 450');
  perform pg_temp.fails(format('select commit_operation(%L, %L, ''redeem'', 3000, 700)', ink_u, kira.member_code), 'не больше 612', 'сверх лимита нельзя');
  r := commit_operation(ink_u, kira.member_code, 'redeem', 3000, null);
  e := (r ->> 'entry_id')::uuid;
  perform pg_temp.eq((select sum(remaining) from point_lots where user_id = kira.id and origin_artist_id = shiro)::bigint, 550::bigint, 'чужих списано ровно 450 (1000 − 450)');

  -- режим unlimited
  perform save_artist_settings(ink_u, (get_artist_settings(ink_u) -> 'tiers'), '{"foreign_mode":"unlimited"}');
  r := quote_operation(ink_u, kira.member_code, 'redeem', 10000, null);
  perform pg_temp.eq((r ->> 'max_redeem')::int, least(3000, (r ->> 'balance_before')::int), 'unlimited: только лимит уровня и баланс');

  -- отмена
  perform pg_temp.eq(((cancel_operation(ink_u, e)) ->> 'balance_after')::bigint, 162::bigint + 1000, 'отмена возвращает списанное');
  perform pg_temp.fails(format('select cancel_operation(%L, %L)', ink_u, e), 'уже отменена', 'повторная отмена');
  perform pg_temp.eq(_spent(kira.id, ink), 12430::bigint, 'отменённая операция не идёт в уровень');
  e2 := (select id from ledger_entries where user_id = kira.id and artist_id = ink and kind = 'accrual' order by created_at limit 1);
  perform pg_temp.fails(format('select cancel_operation(%L, %L)', ink_u, e2), 'уже потрачены', 'нельзя отменить потраченное начисление');
  perform pg_temp.fails(format('select cancel_operation(%L, %L)', shiro_u, e2), 'не найдена', 'чужую операцию не отменить');

  -- inline-начисление
  r := claim_inline('msg-1', ink, dima.id, 4000);
  perform pg_temp.eq((r ->> 'earn')::int, 120, 'inline: клиент вступил и получил 3%');
  perform pg_temp.fails(format('select claim_inline(''msg-1'', %L, %L, 4000)', ink, kira.id), 'уже получены', 'inline одноразовый');
  perform pg_temp.fails(format('select claim_inline(''msg-2'', %L, %L, 4000)', ink, ink_u), 'клиент', 'художник не забирает сам');
  perform pg_temp.eq((select count(*) from inline_claims where ref = 'msg-2')::int, 0, 'неудачная попытка не сжигает сообщение');

  -- сгорание
  perform save_artist_settings(shiro_u, (get_artist_settings(shiro_u) -> 'tiers'), '{"points_ttl_days":"30"}');
  r := commit_operation(shiro_u, dima.member_code, 'earn', 1000, null);
  perform pg_temp.eq((select expires_at is not null from point_lots where entry_id = (r ->> 'entry_id')::uuid), true, 'у АРТов shiro есть срок');
  update point_lots set expires_at = now() - interval '1 day' where entry_id = (r ->> 'entry_id')::uuid;
  perform pg_temp.eq(_balance(dima.id, grp), 120::bigint, 'сгоревшие АРТы не в балансе');

  -- настройки уровней
  perform pg_temp.fails(format('select save_artist_settings(%L, %L, ''{}'')', ink_u,
    '[{"name":"А","min_spent":0,"earn_pct":3,"pay_pct":20},{"name":"Б","min_spent":0,"earn_pct":5,"pay_pct":30}]'), 'больше предыдущего', 'пороги растут');
  perform pg_temp.fails(format('select save_artist_settings(%L, %L, ''{}'')', ink_u,
    '[{"name":"А","min_spent":0,"earn_pct":300,"pay_pct":20}]'), 'от 0 до 100', 'проценты в пределах');
  perform pg_temp.fails(format('select commit_operation(%L, %L, ''earn'', 100, null)', kira.id, dima.member_code), 'только художникам', 'касса только для художников');

  perform pg_temp.eq(jsonb_array_length(get_me(kira.id) -> 'programs'), 1, 'get_me: программы');
  perform pg_temp.eq(jsonb_array_length(get_artist_card(kira.id, ink) -> 'history') > 0, true, 'карточка художника с историей');
  perform pg_temp.eq(jsonb_array_length(artist_clients(ink_u)), 2, 'клиенты художника');
  perform pg_temp.eq((artist_operations(ink_u) -> 'items' -> 0 ->> 'can_cancel')::boolean is not null, true, 'список операций');
end $$;

-- Прямой доступ к данным и функциям для anon закрыт.
set role anon;
select pg_temp.fails('select * from public.users', 'permission denied', 'anon не читает таблицы');
select pg_temp.fails('select public.get_me(gen_random_uuid())', 'permission denied', 'anon не вызывает функции');
reset role;

\echo 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ'
