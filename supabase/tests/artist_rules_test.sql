-- Художник не участник своей программы; мини-обучение.
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
  a1u uuid := (upsert_user(801, 'rule_one', 'Первая', null)).id;
  a2  users := upsert_user(802, 'rule_two', 'Вторая', null);
  su  uuid := (upsert_user(803, 'rule_solo', 'Соло', null)).id;
  late users := upsert_user(804, 'rule_late', 'Поздняя', null);
  c   users := upsert_user(805, null, 'Клиент', null);
  grp uuid; solo uuid; a1 uuid; a2id uuid; r jsonb; cert text;
begin
  grp := (create_group('Правила', 'rules') ->> 'id')::uuid;
  a1 := (accept_invite(a1u, create_invite(1, 'rules') ->> 'code') ->> 'artist_id')::uuid;
  a2id := (accept_invite(a2.id, create_invite(1, 'rules') ->> 'code') ->> 'artist_id')::uuid;
  solo := ((accept_invite(su, create_invite(1, null) ->> 'code')) -> 'program' ->> 'id')::uuid;

  -- Вступить в свою программу нельзя ни в группе, ни соло.
  perform pg_temp.fails(format('select join_program(%L, %L, ''test'')', a1u, grp), 'Художник не может', 'художник не вступает в свою группу');
  perform pg_temp.fails(format('select join_program(%L, %L, ''test'')', su, solo), 'Художник не может', 'соло-художник не вступает к себе');
  -- В чужую программу — можно.
  perform pg_temp.eq((join_program(a1u, solo, 'test') ->> 'joined')::boolean, true, 'художник может быть клиентом другого художника');

  -- Коллега не может получить АРТы через кнопку в чате, донат или сертификат своей группы.
  perform pg_temp.fails(format('select claim_inline(''rule-1'', %L, %L, 3000)', a1, a2.id), 'Художник не может', 'кнопка в чате от коллеги не начисляет');
  perform save_donation_settings(a1u, '[]', 10);
  perform pg_temp.fails(format('select record_donation(%L, %L, 1000)', a1u, a2.member_code), 'Художник не может', 'донат от коллеги не начисляет');
  cert := issue_certificate(a1u, 'group', 1000, '') ->> 'code';
  perform pg_temp.fails(format('select activate_certificate(%L, %L)', a2.id, cert), 'Художник не может', 'коллега не активирует сертификат группы');
  perform pg_temp.fails(format('select commit_operation(%L, %L, ''earn'', 1000, null)', a1u, a2.member_code), 'ещё не в программе', 'касса не начисляет коллеге');

  -- Клиент с АРТами становится художником группы: участие снимается, АРТы сгорают.
  perform join_program(late.id, grp, 'test');
  perform commit_operation(a1u, late.member_code, 'earn', 10000, null);
  perform pg_temp.eq(_balance(late.id, grp) > 0, true, 'у будущего художника есть АРТы');
  r := accept_invite(late.id, create_invite(1, 'rules') ->> 'code');
  perform pg_temp.eq((r ->> 'forfeited')::bigint > 0, true, 'при вступлении художником АРТы сгорели');
  perform pg_temp.eq(exists (select 1 from memberships where user_id = late.id and program_id = grp), false, 'участие в группе снято');
  perform pg_temp.eq(_balance(late.id, grp), 0::bigint, 'баланс обнулён');

  -- «Приведи друга»: художник-пригласивший в своей группе награду не получает, друг — получает.
  perform save_program_settings(a1u, '{"referral": {"enabled": true, "friend_bonus": 50, "referrer_bonus": 70, "min_order": 0}}');
  perform set_referrer(c.id, (select member_code from users where id = a2.id));
  perform join_program(c.id, grp, 'test');
  r := commit_operation(a1u, c.member_code, 'earn', 1000, null);
  perform pg_temp.eq((r -> 'referral' ->> 'referrer_bonus')::int, 0, 'художник-пригласивший без награды в своей группе');
  perform pg_temp.eq((r -> 'referral' ->> 'friend_bonus')::int, 50, 'друг получил бонус');
  perform pg_temp.eq(exists (select 1 from memberships where user_id = a2.id and program_id = grp), false, 'пригласивший не стал участником');

  -- Выход работает.
  perform pg_temp.eq((leave_program(a1u, solo) ->> 'forfeited')::bigint, 0::bigint, 'выход из программы');

  -- Обучение
  perform pg_temp.eq(get_me(c.id) -> 'onboarded', '{"member": false, "artist": false}'::jsonb, 'обучение ещё не пройдено');
  perform set_onboarded(c.id, 'member');
  perform set_onboarded(c.id, 'member');
  perform pg_temp.eq((get_me(c.id) -> 'onboarded' ->> 'member')::boolean, true, 'обучение участника пройдено');
  perform set_onboarded(a1u, 'artist');
  perform pg_temp.eq(get_me(a1u) -> 'onboarded', '{"member": false, "artist": true}'::jsonb, 'обучение художника пройдено');
  perform pg_temp.fails(format('select set_onboarded(%L, ''admin'')', a1u), 'Неизвестная роль', 'роль проверяется');
end $$;
