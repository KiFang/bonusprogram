-- ARTCHIEVE SERVICE v0.1: полная схема из ТЗ (docs/platform/TZ-v0.1.md, раздел 9).
-- Ключевые правила продублированы в базе, чтобы их нельзя было нарушить из приложения:
--   * младше 14 лет зарегистрироваться нельзя;
--   * подросток (14–17) не может иметь прайс, подавать заявки и получать их;
--   * доли оплаты этапов заказа в сумме дают 100%;
--   * условия заявки (snapshot) не меняются после принятия;
--   * в версии 0.1 в файлах допустим только рейтинг general (18+ контента нет).

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nick          text not null unique check (nick ~ '^[a-z0-9_]{3,24}$'),
  display_name  text not null check (char_length(display_name) between 1 and 60),
  avatar_file   uuid,
  birth_date    date not null,
  role          text not null default 'user' check (role in ('user', 'admin')),
  status        text not null default 'active' check (status in ('active', 'blocked', 'deleted')),
  consent_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

create function user_age(p_birth date, p_on date default current_date) returns int
language sql immutable as $$ select extract(year from age(p_on, p_birth))::int $$;

create function user_is_minor(p_user uuid) returns boolean
language sql stable as $$ select coalesce((select user_age(birth_date) < 18 from users where id = p_user), false) $$;

create function users_check_age() returns trigger language plpgsql as $$
begin
  if new.birth_date > current_date then
    raise exception 'Дата рождения в будущем' using errcode = 'P0001';
  end if;
  if user_age(new.birth_date) < 14 then
    raise exception 'Регистрация с 14 лет' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger users_age before insert or update of birth_date on users
  for each row execute function users_check_age();

create table auth_identities (
  user_id      uuid not null references users on delete cascade,
  provider     text not null check (provider in ('email', 'vk', 'yandex', 'gosuslugi')),
  external_id  text not null,
  created_at   timestamptz not null default now(),
  primary key (provider, external_id)
);
create index auth_identities_user_idx on auth_identities (user_id);

create table login_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = lower(email)),
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index login_codes_email_idx on login_codes (email, created_at desc);

create table sessions (
  id          text primary key,           -- sha256 токена, сам токен только в cookie
  user_id     uuid not null references users on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

create table rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (key, window_start)
);

create table files (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users on delete cascade,
  kind        text not null check (kind in ('avatar', 'work', 'reference', 'price', 'stage_preview', 'sample')),
  path        text not null,
  width       int,
  height      int,
  size        bigint not null check (size > 0),
  rating      text not null default 'general' check (rating = 'general'),   -- 0.1: только general
  created_at  timestamptz not null default now()
);
create index files_owner_idx on files (owner_id, kind);
alter table users add constraint users_avatar_fk foreign key (avatar_file) references files on delete set null;

create table artist_profiles (
  user_id            uuid primary key references users on delete cascade,
  bio                text not null default '' check (char_length(bio) <= 2000),
  accepts_orders     boolean not null default false,
  slots_total        int check (slots_total is null or slots_total between 0 and 100),
  revisions_default  int not null default 2 check (revisions_default between 0 and 20),
  rights_default     text not null default 'personal'
                     check (rights_default in ('personal', 'commercial_limited', 'artist_keeps')),
  theme              text not null default 'system' check (theme in ('system', 'light', 'dark')),
  accent             text check (accent is null or accent ~ '^#[0-9a-fA-F]{6}$'),
  created_at         timestamptz not null default now()
);

create table pages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references users on delete cascade,
  status        text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table page_blocks (
  id        uuid primary key default gen_random_uuid(),
  page_id   uuid not null references pages on delete cascade,
  type      text not null check (type in ('header', 'portfolio', 'about', 'price', 'links', 'text')),
  position  int not null check (position >= 0),
  data      jsonb not null default '{}'::jsonb,
  unique (page_id, position) deferrable initially deferred
);

create table price_items (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references users on delete cascade,
  title        text not null check (char_length(title) between 1 and 80),
  description  text not null default '' check (char_length(description) <= 1000),
  base_price   int not null check (base_price between 0 and 10000000),
  days         int check (days is null or days between 1 and 365),
  sample_file  uuid references files on delete set null,
  position     int not null default 0,
  active       boolean not null default true
);
create index price_items_artist_idx on price_items (artist_id, position);

create table price_options (
  id        uuid primary key default gen_random_uuid(),
  item_id   uuid not null references price_items on delete cascade,
  title     text not null check (char_length(title) between 1 and 80),
  kind      text not null check (kind in ('fixed', 'multiplier')),
  value     numeric(10, 2) not null,
  grp       text,                              -- опции с одним grp взаимоисключающие («одно из»)
  required  boolean not null default false,
  position  int not null default 0,
  check ((kind = 'fixed' and value between 0 and 1000000) or (kind = 'multiplier' and value > 0 and value <= 10))
);
create index price_options_item_idx on price_options (item_id, position);

create table price_zones (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references users on delete cascade,
  file_id    uuid not null references files on delete cascade,
  item_id    uuid not null references price_items on delete cascade,
  x numeric(5, 2) not null, y numeric(5, 2) not null, w numeric(5, 2) not null, h numeric(5, 2) not null,
  check (x >= 0 and y >= 0 and w > 0 and h > 0 and x + w <= 100 and y + h <= 100)
);

create function forbid_minor_artist() returns trigger language plpgsql as $$
begin
  if user_is_minor(new.artist_id) then
    raise exception 'Несовершеннолетний не может иметь прайс' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger price_items_minor before insert on price_items
  for each row execute function forbid_minor_artist();

create table requests (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references users,
  artist_id   uuid not null references users,
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  snapshot    jsonb not null,                  -- позиции, опции, правки, права, срок на момент отправки
  price_total int not null check (price_total >= 0),
  days        int,
  message     text not null default '' check (char_length(message) <= 4000),
  decline_reason text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  check (client_id <> artist_id)
);
create index requests_artist_idx on requests (artist_id, status, created_at desc);
create index requests_client_idx on requests (client_id, created_at desc);

create function requests_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if user_is_minor(new.client_id) then
      raise exception 'Несовершеннолетний не может отправлять заявки' using errcode = 'P0001';
    end if;
    if user_is_minor(new.artist_id) then
      raise exception 'Этот художник пока не принимает заявки' using errcode = 'P0001';
    end if;
  elsif old.status <> 'pending' and (new.snapshot is distinct from old.snapshot or new.price_total <> old.price_total) then
    raise exception 'Условия принятой заявки менять нельзя' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger requests_guard_ins before insert on requests for each row execute function requests_guard();
create trigger requests_guard_upd before update on requests for each row execute function requests_guard();

create table request_refs (
  request_id  uuid not null references requests on delete cascade,
  file_id     uuid not null references files on delete cascade,
  primary key (request_id, file_id)
);

create table orders (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null unique references requests,
  artist_id       uuid not null references users,
  client_id       uuid not null references users,
  status          text not null default 'active' check (status in ('active', 'done', 'cancelled')),
  price_total     int not null check (price_total >= 0),
  paid_total      int not null default 0 check (paid_total >= 0),
  revisions_left  int not null default 0 check (revisions_left >= 0),
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create index orders_artist_idx on orders (artist_id, status);
create index orders_client_idx on orders (client_id, status);

create table order_stages (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders on delete cascade,
  position   int not null check (position >= 0),
  title      text not null check (char_length(title) between 1 and 32),
  pay_share  int not null check (pay_share between 0 and 100),
  status     text not null default 'waiting' check (status in ('waiting', 'in_progress', 'review', 'approved')),
  unique (order_id, position) deferrable initially deferred
);

-- Доли оплаты этапов в сумме дают 100%. Проверяется в конце транзакции, поэтому этапы можно вставлять по одному.
create function order_stages_share_check() returns trigger language plpgsql as $$
declare
  v_order uuid := coalesce(new.order_id, old.order_id);
  v_sum int;
  v_cnt int;
begin
  select coalesce(sum(pay_share), 0), count(*) into v_sum, v_cnt from order_stages where order_id = v_order;
  if v_cnt > 0 and v_sum <> 100 then
    raise exception 'Доли оплаты этапов должны давать 100%% (сейчас %)', v_sum using errcode = 'P0001';
  end if;
  return null;
end $$;
create constraint trigger order_stages_share after insert or update or delete on order_stages
  deferrable initially deferred for each row execute function order_stages_share_check();

create table order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders on delete cascade,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  actor_id    uuid references users,
  created_at  timestamptz not null default now()
);
create index order_events_order_idx on order_events (order_id, created_at);

create table reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references users,
  target_type  text not null check (target_type in ('page', 'file', 'user', 'request', 'order')),
  target_id    uuid not null,
  reason       text not null check (char_length(reason) between 3 and 1000),
  status       text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at   timestamptz not null default now()
);
create index reports_status_idx on reports (status, created_at);

create table admin_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references users,
  action      text not null,
  target      text not null,
  reason      text not null,
  created_at  timestamptz not null default now()
);

create table jobs (
  id        uuid primary key default gen_random_uuid(),
  kind      text not null,
  payload   jsonb not null default '{}'::jsonb,
  run_at    timestamptz not null default now(),
  attempts  int not null default 0,
  status    text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error     text,
  created_at timestamptz not null default now()
);
create index jobs_queue_idx on jobs (status, run_at);
