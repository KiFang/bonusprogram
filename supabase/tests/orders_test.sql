-- Проверки заказов и этапов.
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
  art_u uuid := (upsert_user(301, 'mira_art', 'Мира', null)).id;
  other_u uuid := (upsert_user(302, 'other_art', 'Другой', null)).id;
  cli users := upsert_user(401, null, 'Лена', null);
  outsider users := upsert_user(402, null, 'Чужой', null);
  grp uuid; r jsonb; ord uuid; ord2 uuid;
begin
  grp := (create_group('Орден', 'orden') ->> 'id')::uuid;
  perform accept_invite(art_u, create_invite(1, 'orden') ->> 'code');
  perform accept_invite(other_u, create_invite(1, null) ->> 'code');
  perform join_program(cli.id, grp, 'test');

  perform pg_temp.fails(format('select create_order(%L, %L, ''Портрет'', 5000, null)', art_u, outsider.member_code),
    'ещё не в вашей программе', 'заказ только участнику');
  perform pg_temp.fails(format('select create_order(%L, %L, '''', 5000, null)', art_u, cli.member_code),
    'от 1 до 80', 'пустое название');
  perform pg_temp.fails(format('select create_order(%L, %L, ''X'', 1, %L)', art_u, cli.member_code, '{Один}'),
    'от 2 до 8', 'меньше двух этапов нельзя');

  r := create_order(art_u, cli.member_code, 'Портрет в полный рост', 6000, null);
  ord := (r ->> 'id')::uuid;
  perform pg_temp.eq(r ->> 'stage_name', 'Очередь', 'этапы из шаблона');
  perform pg_temp.eq((r ->> 'member_telegram_id')::bigint, 401::bigint, 'телеграм клиента для уведомления');

  r := create_order(art_u, cli.member_code, 'Стикеры', null, array[' Идея ', 'Готово']);
  ord2 := (r ->> 'id')::uuid;
  perform pg_temp.eq(r -> 'stages', '["Идея", "Готово"]'::jsonb, 'свои этапы, пробелы обрезаны');

  -- этапы
  r := set_order_stage(art_u, ord, 1);
  perform pg_temp.eq(r ->> 'event', 'stage', 'смена этапа');
  perform pg_temp.eq(r ->> 'stage_name', 'Скетч', 'название этапа');
  r := set_order_stage(art_u, ord, 3);
  perform pg_temp.eq(r ->> 'status', 'done', 'последний этап = готово');
  perform pg_temp.eq(r ->> 'event', 'done', 'событие готово');
  r := set_order_stage(art_u, ord, 2);
  perform pg_temp.eq(r ->> 'event', 'reopened', 'возврат из готового');
  perform pg_temp.eq(r ->> 'status', 'active', 'снова в работе');
  perform pg_temp.fails(format('select set_order_stage(%L, %L, 9)', art_u, ord), 'Нет такого этапа', 'этап за пределами');
  perform pg_temp.fails(format('select set_order_stage(%L, %L, 1)', other_u, ord), 'не найден', 'чужой художник не двигает заказ');

  -- оплата по заказу
  r := quote_operation(art_u, cli.member_code, 'earn', 3000, null, null);
  perform pg_temp.eq(jsonb_array_length(r -> 'orders'), 2, 'касса видит активные заказы клиента');
  r := commit_operation(art_u, cli.member_code, 'earn', 3000, null, ord);
  perform pg_temp.eq(r -> 'order' ->> 'title', 'Портрет в полный рост', 'оплата привязана к заказу');
  perform commit_operation(art_u, cli.member_code, 'earn', 3000, null);  -- без заказа, старый вызов
  r := get_order(cli.id, ord);
  perform pg_temp.eq((r ->> 'paid')::int, 3000, 'оплачено по заказу');
  perform pg_temp.eq(jsonb_array_length(r -> 'payments'), 1, 'платёж в карточке заказа');
  perform pg_temp.eq(jsonb_array_length(r -> 'events'), 4, 'история этапов');
  perform pg_temp.eq((r ->> 'is_artist')::boolean, false, 'клиент видит заказ как клиент');
  perform pg_temp.eq((get_order(art_u, ord) ->> 'is_artist')::boolean, true, 'художник видит как художник');
  perform pg_temp.fails(format('select get_order(%L, %L)', outsider.id, ord), 'не найден', 'посторонний не видит заказ');
  perform pg_temp.fails(format('select commit_operation(%L, %L, ''earn'', 100, null, %L)', other_u, cli.member_code, ord),
    'не в программе', 'чужой художник не платит по заказу');

  -- отмена
  perform cancel_order(art_u, ord2);
  perform pg_temp.fails(format('select set_order_stage(%L, %L, 1)', art_u, ord2), 'отменён', 'отменённый не двигается');
  perform pg_temp.fails(format('select commit_operation(%L, %L, ''earn'', 100, null, %L)', art_u, cli.member_code, ord2),
    'не найден', 'по отменённому не платят');
  perform pg_temp.eq(jsonb_array_length(member_orders(cli.id)), 1, 'клиент не видит отменённые');
  perform pg_temp.eq(jsonb_array_length(artist_orders(art_u)), 2, 'художник видит все');

  -- шаблон этапов
  perform pg_temp.eq(save_order_stages(art_u, array['Бриф', 'Лайн', 'Цвет', 'Готово']), '["Бриф", "Лайн", "Цвет", "Готово"]'::jsonb, 'свой шаблон');
  perform pg_temp.eq((create_order(art_u, cli.member_code, 'Ещё', null, '{}') ->> 'stage_name'), 'Бриф', 'новый заказ по шаблону');
  perform pg_temp.fails(format('select save_order_stages(%L, %L)', art_u, '{Один}'), 'от 2 до 8', 'шаблон проверяется');
end $$;

\echo 'ЗАКАЗЫ: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ'
