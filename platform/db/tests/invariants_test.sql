-- Правила базы: возраст, подростки, доли этапов, неизменность условий заявки, рейтинг файлов.
\set ON_ERROR_STOP on

create function pg_temp.eq(actual anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: ожидали %, получили %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;

-- sql — команда, needle — часть текста ожидаемой ошибки
create function pg_temp.fails(sql text, needle text, label text) returns void language plpgsql as $$
begin
  execute sql;
  execute 'set constraints all immediate';     -- отложенные проверки срабатывают сразу, а не при коммите
  raise exception 'FAIL %: ошибки не было', label;
exception when others then
  if sqlerrm like 'FAIL %' then raise; end if;
  if position(needle in sqlerrm) = 0 then
    raise exception 'FAIL %: другая ошибка: %', label, sqlerrm;
  end if;
  raise notice 'ok  % (%)', label, sqlerrm;
end $$;

create function pg_temp.mkuser(p_nick text, p_age int) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into users (email, nick, display_name, birth_date, consent_at)
  values (p_nick || '@example.ru', p_nick, p_nick, current_date - make_interval(years => p_age, days => 3), now())
  returning id into v;
  return v;
end $$;

do $$
declare
  adult uuid; teen uuid; client uuid; req uuid; ord uuid; item uuid;
begin
  -- возраст
  perform pg_temp.fails($q$select pg_temp.mkuser('kid13', 13)$q$, 'с 14 лет', 'младше 14 регистрироваться нельзя');
  teen := pg_temp.mkuser('teen15', 15);
  adult := pg_temp.mkuser('adult30', 30);
  client := pg_temp.mkuser('client25', 25);
  perform pg_temp.eq(user_is_minor(teen), true, '15 лет — подросток');
  perform pg_temp.eq(user_is_minor(adult), false, '30 лет — взрослый');
  perform pg_temp.eq(user_age(date '2000-06-15', date '2018-06-14'), 17, 'возраст за день до дня рождения');
  perform pg_temp.eq(user_age(date '2000-06-15', date '2018-06-15'), 18, 'возраст в день рождения');
  perform pg_temp.fails(format($q$update users set birth_date = current_date - interval '10 years' where id = %L$q$, adult),
                        'с 14 лет', 'нельзя поменять дату рождения на детскую');
  perform pg_temp.fails($q$insert into users (email, nick, display_name, birth_date, consent_at)
                          values ('Bad@Example.ru', 'badcase', 'x', '1990-01-01', now())$q$, 'check', 'почта только в нижнем регистре');
  perform pg_temp.fails($q$insert into users (email, nick, display_name, birth_date, consent_at)
                          values ('n@example.ru', 'Bad Nick', 'x', '1990-01-01', now())$q$, 'check', 'ник: только латиница, цифры, _');

  -- прайс и заявки
  perform pg_temp.fails(format($q$insert into price_items (artist_id, title, base_price) values (%L, 'Портрет', 3000)$q$, teen),
                        'прайс', 'подросток не заводит прайс');
  insert into price_items (artist_id, title, base_price, days) values (adult, 'Портрет', 3000, 7) returning id into item;
  perform pg_temp.fails(format($q$insert into price_options (item_id, title, kind, value) values (%L, 'Фон', 'multiplier', 0)$q$, item),
                        'check', 'множитель должен быть больше нуля');
  insert into price_options (item_id, title, kind, value) values (item, 'Фон', 'fixed', 500);
  perform pg_temp.fails(format($q$insert into price_zones (artist_id, file_id, item_id, x, y, w, h)
                                  values (%L, gen_random_uuid(), %L, 90, 0, 20, 10)$q$, adult, item),
                        'violates', 'зона не выходит за картинку');

  perform pg_temp.fails(format($q$insert into requests (client_id, artist_id, snapshot, price_total) values (%L, %L, '{}', 3000)$q$, teen, adult),
                        'не может отправлять', 'подросток не отправляет заявки');
  perform pg_temp.fails(format($q$insert into requests (client_id, artist_id, snapshot, price_total) values (%L, %L, '{}', 3000)$q$, client, teen),
                        'не принимает', 'заявку подростку отправить нельзя');
  perform pg_temp.fails(format($q$insert into requests (client_id, artist_id, snapshot, price_total) values (%L, %L, '{}', 3000)$q$, adult, adult),
                        'check', 'заявка самому себе');
  insert into requests (client_id, artist_id, snapshot, price_total) values (client, adult, '{"items": []}', 3500) returning id into req;
  update requests set snapshot = '{"items": [1]}', price_total = 3200 where id = req;       -- пока pending можно
  perform pg_temp.eq((select price_total from requests where id = req), 3200, 'до принятия условия можно править');
  update requests set status = 'accepted', decided_at = now() where id = req;
  perform pg_temp.fails(format($q$update requests set price_total = 1 where id = %L$q$, req), 'менять нельзя', 'после принятия цена заморожена');
  perform pg_temp.fails(format($q$update requests set snapshot = '{}' where id = %L$q$, req), 'менять нельзя', 'после принятия снимок заморожен');

  -- заказ и доли этапов
  insert into orders (request_id, artist_id, client_id, price_total, revisions_left) values (req, adult, client, 3200, 2) returning id into ord;
  insert into order_stages (order_id, position, title, pay_share) values
    (ord, 0, 'Бриф', 30), (ord, 1, 'Скетч', 30), (ord, 2, 'Готово', 40);
  perform pg_temp.eq((select count(*)::int from order_stages where order_id = ord), 3, 'этапы с суммой долей 100 сохранились');
end $$;

-- проверка в конце транзакции: неверная сумма долей ловится при коммите
do $$
declare ord uuid;
begin
  select id into ord from orders limit 1;
  begin
    perform pg_temp.fails(format($q$update order_stages set pay_share = 10 where order_id = %L and position = 2$q$, ord), 'сейчас', 'доли не дают 100');
  exception when others then
    raise;
  end;
end $$;

do $$
declare ord uuid; adult uuid;
begin
  select id, artist_id into ord, adult from orders limit 1;
  -- порядок этапов неизменен: повторная позиция запрещена
  perform pg_temp.fails(format($q$insert into order_stages (order_id, position, title, pay_share) values (%L, 0, 'Дубль', 0)$q$, ord),
                        'duplicate', 'позиция этапа уникальна');
  -- рейтинг файлов
  perform pg_temp.fails(format($q$insert into files (owner_id, kind, path, size, rating) values (%L, 'work', 'a.webp', 10, 'explicit')$q$, adult),
                        'check', '18+ в файлах пока запрещён базой');
  insert into files (owner_id, kind, path, size) values (adult, 'work', 'a.webp', 10);
  perform pg_temp.eq((select rating from files where owner_id = adult), 'general', 'рейтинг по умолчанию general');
end $$;

\echo ВСЕ ПРОВЕРКИ БАЗЫ ПРОЙДЕНЫ
