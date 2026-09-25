-- Проверки V1/V2: выход, коллекция, слоты, приведи друга, ДР, донаты, акции, сертификаты, Stars, сбор, Business, заявки.
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
  a1u uuid := (upsert_user(501, 'first_art', 'Первый', null)).id;
  a2u uuid := (upsert_user(502, 'second_art', 'Второй', null)).id;
  c1 users := upsert_user(601, null, 'Аня', null);
  c2 users := upsert_user(602, null, 'Боря', null);
  c3 users := upsert_user(603, 'candidate', 'Кандидат', null);
  grp uuid; a1 uuid; a2 uuid; r jsonb; req uuid; ord uuid; cert text; inv uuid; item uuid; bal bigint;
begin
  grp := (create_group('Фичи', 'feat') ->> 'id')::uuid;
  a1 := (accept_invite(a1u, create_invite(1, 'feat') ->> 'code') ->> 'artist_id')::uuid;
  a2 := (accept_invite(a2u, create_invite(1, 'feat') ->> 'code') ->> 'artist_id')::uuid;
  perform pg_temp.eq((select is_group_admin from artists where id = a1), true, 'первый художник — админ группы');
  perform pg_temp.eq((select is_group_admin from artists where id = a2), false, 'второй — не админ');
  perform pg_temp.fails(format('select save_program_settings(%L, ''{}'')', a2u), 'админ группы', 'настройки программы только админу');

  -- «Приведи друга»: включаем, привязываем Борю к Ане
  perform join_program(c1.id, grp, 'test');
  perform save_program_settings(a1u, '{"referral": {"enabled": true, "friend_bonus": 50, "referrer_bonus": 70, "min_order": 1000}}');
  perform pg_temp.eq(set_referrer(c2.id, replace(c1.member_code, '-', '')) ->> 'status', 'ok', 'реферальный код без дефиса');
  perform pg_temp.eq(set_referrer(c2.id, c1.member_code) ->> 'status', 'already', 'пригласивший один');
  perform pg_temp.eq(set_referrer(c1.id, c1.member_code) ->> 'status', 'invalid', 'сам себя не пригласить');
  perform join_program(c2.id, grp, 'test');
  r := commit_operation(a1u, c2.member_code, 'earn', 500, null);
  perform pg_temp.eq(r -> 'referral', 'null'::jsonb, 'заказ меньше минимума — без бонуса');
  r := commit_operation(a1u, c2.member_code, 'earn', 2000, null);
  perform pg_temp.eq((r -> 'referral' ->> 'referrer_bonus')::int, 70, 'бонус пригласившему');
  perform pg_temp.eq(_balance(c2.id, grp), 15::bigint + 60 + 50, 'друг: 3% + 3% + 50 бонус');
  perform pg_temp.eq(_balance(c1.id, grp), 70::bigint, 'пригласившая получила 70');
  r := commit_operation(a1u, c2.member_code, 'earn', 2000, null);
  perform pg_temp.eq(r -> 'referral', 'null'::jsonb, 'бонус только один раз');
  perform pg_temp.eq(set_referrer(c1.id, c2.member_code) ->> 'status', 'too_late', 'после операций пригласившего не указать');

  -- Акция ×2
  perform create_promotion(a1u, 'Выходные', 2, now() - interval '1 hour', now() + interval '1 day');
  r := quote_operation(a1u, c1.member_code, 'earn', 1000, null);
  perform pg_temp.eq((r ->> 'earn')::int, 60, 'акция удваивает 3%');
  perform pg_temp.fails(format('select create_promotion(%L, ''X'', 9, now(), now() + interval ''1 day'')', a1u), 'от 1,1 до 5', 'множитель ограничен');
  delete from promotions where artist_id = a1;

  -- День рождения: повышенный процент
  perform set_birthday(c1.id, extract(day from now() at time zone 'Europe/Moscow')::int, extract(month from now() at time zone 'Europe/Moscow')::int);
  perform save_program_settings(a1u, '{"birthday": {"mode": "boost", "boost_pct": 5, "window_days": 2}}');
  r := quote_operation(a1u, c1.member_code, 'earn', 1000, null);
  perform pg_temp.eq((r ->> 'earn')::int, 80, 'в день рождения 3% + 5%');
  perform pg_temp.fails(format('select set_birthday(%L, 1, 1)', c1.id), 'раз в год', 'дату рождения часто не менять');
  perform pg_temp.fails(format('select set_birthday(%L, 31, 2)', c2.id), 'Такой даты нет', '31 февраля нет');
  -- бонус по расписанию
  perform save_program_settings(a1u, '{"birthday": {"mode": "bonus", "bonus": 300, "ttl_days": 10}}');
  r := grant_birthday_bonuses();
  perform pg_temp.eq(jsonb_array_length(r), 1, 'бонус ДР начислен одной');
  perform pg_temp.eq(jsonb_array_length(grant_birthday_bonuses()), 0, 'повторно в этом году — нет');
  perform pg_temp.eq(_balance(c1.id, grp), 70::bigint + 300, 'баланс с подарком');
  perform save_program_settings(a1u, '{"birthday": {"mode": "off"}}');

  -- Донаты
  r := record_donation(a1u, c1.member_code, 500);
  perform pg_temp.eq((r ->> 'points')::int, 0, 'донат без ставки — без АРТов');
  perform save_donation_settings(a1u, '[{"title": "Boosty", "url": "https://boosty.to/x"}]', 10);
  r := record_donation(a1u, c1.member_code, 500);
  perform pg_temp.eq((r ->> 'points')::int, 50, 'донат со ставкой 10%');
  perform pg_temp.eq(_spent(c1.id, a1), 0::bigint, 'донат не идёт в уровень');
  perform pg_temp.fails(format('select save_donation_settings(%L, %L, null)', a1u, '[{"title": "X", "url": "boosty.to"}]'), 'https://', 'ссылка должна быть https');

  -- Сертификаты: художника и группы
  cert := issue_certificate(a1u, 'artist', 1000, 'Подарок') ->> 'code';
  perform pg_temp.fails(format('select activate_certificate(%L, %L)', a1u, cert), 'свой сертификат', 'художник не активирует свой');
  r := activate_certificate(c2.id, cert);
  perform pg_temp.eq(r ->> 'status', 'activated', 'сертификат активирован');
  perform pg_temp.fails(format('select activate_certificate(%L, %L)', c1.id, cert), 'уже активирован', 'дважды нельзя');
  bal := _balance(c2.id, grp);
  -- у первого художника: лимит уровня 20% не действует на сертификат
  r := quote_operation(a1u, c2.member_code, 'redeem', 2000, null);
  perform pg_temp.eq((r ->> 'max_redeem')::int, 1000 + 185, 'сертификат целиком + все обычные (185 < лимита 400)');
  perform pg_temp.eq((r ->> 'gift_used')::int, 1000, 'сначала тратится сертификат');
  -- у второго художника в режиме by_tier сертификат первого — чужие АРТы
  perform save_artist_settings(a2u, get_artist_settings(a2u) -> 'tiers', '{"foreign_mode": "by_tier"}');
  r := quote_operation(a2u, c2.member_code, 'redeem', 2000, null);
  perform pg_temp.eq((r ->> 'max_redeem')::int, 200 + 50, 'у коллеги с by_tier: сертификат первого — чужие (лимит 10%) + свои бонусные 50');
  perform pg_temp.fails(format('select commit_operation(%L, %L, ''redeem'', 2000, 1200)', a1u, c2.member_code), 'не больше 1185', 'сверх максимума нельзя');
  r := commit_operation(a1u, c2.member_code, 'redeem', 2000, null);
  perform pg_temp.eq((r ->> 'gift_used')::int, 1000, 'списано 1000 сертификатом');
  perform pg_temp.eq((r ->> 'paid')::int, 815, 'доплата деньгами');
  perform pg_temp.eq(_spent(c2.id, a1), 500::bigint + 2000 + 2000 + 815 + 1000, 'сертификат засчитан в уровень');
  perform commit_operation(a1u, c2.member_code, 'earn', 4000, null);  -- Боря выходит на «Холст»
  cert := issue_certificate(a2u, 'group', 300, '') ->> 'code';
  perform activate_certificate(c1.id, cert);
  r := quote_operation(a2u, c1.member_code, 'redeem', 300, null);
  perform pg_temp.eq((r ->> 'gift_used')::int, 300, 'сертификат группы без ограничений');
  cert := issue_certificate(a1u, 'artist', 200, '') ->> 'code';
  perform pg_temp.eq(void_certificate(a1u, (select id from gift_certificates where code = cert)) ->> 'status', 'void', 'аннулирование своего');

  -- Stars: покупка сертификата
  r := create_stars_invoice(c1.id, 'certificate', a1, 'artist', 1001);
  inv := (r ->> 'id')::uuid;
  perform pg_temp.eq((r ->> 'stars')::int, 501, '1001 АРТ = 501 ★ (округление вверх)');
  perform pg_temp.eq(check_stars_invoice(inv, 501, 601), true, 'счёт проходит проверку');
  perform pg_temp.eq(check_stars_invoice(inv, 500, 601), false, 'неверная сумма отклоняется');
  perform pg_temp.eq(check_stars_invoice(inv, 501, 602), false, 'чужой плательщик отклоняется');
  r := complete_stars_invoice(inv, 'charge-1', 501);
  perform pg_temp.eq(r -> 'data' ->> 'paid_via', 'stars', 'сертификат выпущен за Stars');
  perform pg_temp.eq((complete_stars_invoice(inv, 'charge-1', 501) ->> 'duplicate')::boolean, true, 'повтор оплаты не дублирует');
  perform pg_temp.eq(jsonb_array_length(stars_payouts()), 1, 'звёзды к выплате художнику');
  perform pg_temp.eq(mark_stars_paid('first_art'), 1, 'выплата отмечена');

  -- Общий сбор
  perform pg_temp.fails(format('select create_fundraiser(%L, ''Стенд'', 50000)', a2u), 'админ группы', 'сбор создаёт админ');
  perform create_fundraiser(a1u, 'Стенд на фестивале', 50000);
  perform add_contribution(a2u, 5000, 'наличными');
  r := create_stars_invoice(c1.id, 'fundraiser', (select id from fundraisers where program_id = grp and status = 'active'), null, 1000);
  perform complete_stars_invoice((r ->> 'id')::uuid, 'charge-2', 500);
  perform pg_temp.eq(((get_me(c1.id) -> 'programs' -> 0 -> 'fundraiser') ->> 'raised')::int, 6000, 'сбор виден в кошельке');

  -- Слоты
  perform set_slots(a1u, 'rest', null);
  perform pg_temp.fails(format('select request_slot(%L, %L, ''хочу'')', c1.id, a1), 'отдыхает', 'в ресте заявок нет');
  perform save_artist_settings(a1u, jsonb_set(get_artist_settings(a1u) -> 'tiers', '{1,early_hours}', '24'), '{}');
  r := set_slots(a1u, 'open', 1);
  perform pg_temp.eq((r ->> 'announce')::boolean, true, 'открытие слотов анонсируется');
  -- у Ани уровень «Эскиз» (early 0): ей откроется через 24 часа
  perform pg_temp.fails(format('select request_slot(%L, %L, ''хочу'')', c1.id, a1), 'откроются', 'ранний доступ только высоким уровням');
  -- у Бори «Холст» (6300 ₽ у художника) — early 24, может сразу
  r := request_slot(c2.id, a1, 'Портрет кота');
  req := (r ->> 'id')::uuid;
  perform pg_temp.fails(format('select request_slot(%L, %L, ''ещё'')', c2.id, a1), 'уже отправлена', 'одна заявка за раз');
  perform pg_temp.fails(format('select leave_program(%L, %L)', c2.id, grp), 'заявку на слот', 'нельзя выйти с заявкой');
  r := decide_slot_request(a1u, req, true, null, 4000);
  ord := (r -> 'order' ->> 'id')::uuid;
  perform pg_temp.eq(r -> 'order' ->> 'title', 'Портрет кота', 'заявка стала заказом');
  perform pg_temp.eq((_slots_info(a1, null) ->> 'free')::int, 0, 'слот занят');
  update artists set slots_opened_at = now() - interval '2 days' where id = a1;
  perform pg_temp.fails(format('select request_slot(%L, %L, ''хочу'')', c1.id, a1), 'Свободных слотов нет', 'все слоты заняты');

  -- Коллекция
  r := add_gallery_item(a1u, ord, a1::text || '/' || ord::text || '/1.jpg', false);
  item := (r ->> 'id')::uuid;
  perform pg_temp.fails(format('select add_gallery_item(%L, %L, ''other/1.jpg'', false)', a1u, ord), 'путь', 'путь только в папке художника');
  perform pg_temp.eq(jsonb_array_length(member_gallery(c2.id)), 1, 'арт в коллекции клиента');
  perform pg_temp.eq((set_gallery_hidden(c2.id, item, true) ->> 'hidden')::boolean, true, 'клиент скрывает арт');
  perform pg_temp.fails(format('select set_gallery_hidden(%L, %L, true)', c1.id, item), 'не найдена', 'чужой арт не скрыть');
  perform pg_temp.eq(jsonb_array_length(get_order(c2.id, ord) -> 'gallery'), 1, 'арт в карточке заказа');
  perform pg_temp.eq(delete_gallery_item(a1u, item), a1::text || '/' || ord::text || '/1.jpg', 'удаление возвращает путь файла');

  -- Выход из программы
  r := leave_program(c1.id, grp);
  perform pg_temp.eq((r ->> 'forfeited')::bigint > 0, true, 'АРТы сгорели');
  perform pg_temp.eq(_balance(c1.id, grp), 0::bigint, 'баланс 0');
  perform pg_temp.eq(exists (select 1 from memberships where program_id = grp and user_id = c1.id), false, 'участник вышел');
  perform pg_temp.fails(format('select leave_program(%L, %L)', c1.id, grp), 'не состоите', 'второй раз не выйти');
  perform join_program(c1.id, grp, 'test');
  perform pg_temp.eq(_balance(c1.id, grp), 0::bigint, 'после возвращения баланс с нуля');

  -- Telegram Business
  perform save_business_connection('bc1', 501, true, true);
  r := business_accrual('bc1', 501, c3.id, 3000);
  perform pg_temp.eq((r ->> 'earn')::int, 90, 'начисление через /addart');
  perform pg_temp.fails(format('select business_accrual(''bc1'', 502, %L, 100)', c3.id), 'не найдено', 'чужое подключение не работает');

  -- Заявки художников
  perform pg_temp.fails(format('select submit_application(%L, ''Рисую'', '''', ''nope'')', c3.id), 'Такой группы нет', 'проверка группы');
  r := submit_application(c3.id, 'Рисую котов', 'https://t.me/candidate_art', 'feat');
  perform pg_temp.fails(format('select submit_application(%L, ''ещё'', '''', ''solo'')', c3.id), 'уже отправлена', 'одна заявка');
  perform pg_temp.fails(format('select submit_application(%L, ''я'', '''', ''solo'')', c2.id), 'username', 'без username нельзя');
  r := decide_application(1, (r ->> 'id')::uuid, true);
  perform pg_temp.eq(r ->> 'status', 'approved', 'заявка одобрена');
  perform pg_temp.eq((select p.slug from artists a join programs p on p.id = a.program_id where a.user_id = c3.id), 'feat', 'художник в нужной группе');
end $$;

\echo 'ФИЧИ: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ'
