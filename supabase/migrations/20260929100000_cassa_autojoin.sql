-- Касса: клиент, которого ещё нет в программе, вступает при первом начислении.
-- Раньше художник получал ошибку «ещё не в программе» и не знал, что делать дальше.
-- Оплатить АРТами без участия по-прежнему нельзя (АРТов нет), коллегу по группе — тоже.

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
  v_joining boolean := false;
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
  -- Клиент, которого ещё нет в программе, вступает при первом начислении (он показал код художнику).
  if not exists (select 1 from memberships where program_id = a.program_id and user_id = m.id) then
    if _is_artist_in(m.id, a.program_id) then
      perform _fail('Художник не может быть участником программы своей группы');
    end if;
    if p_mode = 'redeem' then
      perform _fail(format('%s ещё не в программе «%s», АРТов для оплаты нет', m.first_name, p.name));
    end if;
    v_joining := true;
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
    'order', case when o.id is not null then jsonb_build_object('id', o.id, 'title', o.title) end,
    'joining', v_joining);

  if not p_commit then return result; end if;

  if p_redeem is not null and p_redeem > v_max then
    perform _fail(format('Можно списать не больше %s АРТ', v_max));
  end if;
  if p_mode = 'redeem' and v_r <= 0 then perform _fail('Нечего списать'); end if;
  if v_joining then
    insert into memberships (program_id, user_id, source) values (a.program_id, m.id, coalesce(p_source, 'cassa'));
  end if;

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

-- Заказ для клиента, которого ещё нет в программе, тоже записывает его в программу.
create or replace function public.create_order(p_artist_user uuid, p_member_code text, p_title text, p_price bigint, p_stages text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a artists := _artist_by_user(p_artist_user);
  m users := find_member(p_member_code);
  v_stages text[];
  o orders;
begin
  if m.id = a.user_id then perform _fail('Нельзя создать заказ самому себе'); end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 80 then
    perform _fail('Название заказа — от 1 до 80 символов');
  end if;
  if p_price is not null and (p_price < 0 or p_price > 10000000) then perform _fail('Некорректная цена'); end if;
  v_stages := coalesce(nullif(_clean_stages(p_stages), '{}'), a.order_stages);
  if not _valid_stages(v_stages) then perform _fail('Этапов должно быть от 2 до 8, у каждого — название до 32 символов'); end if;

  insert into memberships (program_id, user_id, source) values (a.program_id, m.id, 'order') on conflict do nothing;
  insert into orders (artist_id, program_id, user_id, title, price, stages)
  values (a.id, a.program_id, m.id, btrim(p_title), p_price, v_stages)
  returning * into o;
  insert into order_events (order_id, kind, stage, stage_name) values (o.id, 'created', 0, v_stages[1]);
  return _order_json(o) || jsonb_build_object('member_telegram_id', m.telegram_id);
end $$;

revoke all on function public._operation(uuid, uuid, text, bigint, bigint, boolean, text, uuid, uuid),
  public.create_order(uuid, text, text, bigint, text[]) from public, anon, authenticated;
grant execute on function public._operation(uuid, uuid, text, bigint, bigint, boolean, text, uuid, uuid),
  public.create_order(uuid, text, text, bigint, text[]) to service_role;
