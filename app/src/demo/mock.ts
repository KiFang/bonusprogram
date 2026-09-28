// Демо-режим: Mini App без Telegram и без сервера. Все данные выдуманные и живут в памяти вкладки.
// Логика расчётов упрощена, но повторяет настоящую: уровни, лимит оплаты АРТами, общий кошелёк группы.
import type {
  Artist, Certificate, Entry, Fundraiser, GalleryItem, Me, Order, OrderDetail, Program, Promotion, Quote, Slots, Tier, TierInfo,
} from "../api";

type T = { name: string; min_spent: number; earn_pct: number; pay_pct: number; foreign_pct: number; perks: string; early_hours: number };
type A = Artist & { tiers: T[]; order_stages: string[]; donate_links: { title: string; url: string }[]; donation_earn_pct: number | null; slots_total: number; slots_opened_at: string | null };
type U = { id: string; name: string; username: string | null; code: string };
type E = Entry & { user_id: string; program_id: string; artist_id: string | null; order_id: string | null };
type O = { id: string; artist_id: string; user_id: string; title: string; price: number | null; stages: string[]; stage: number; status: Order["status"]; created_at: string; updated_at: string; done_at: string | null; events: OrderDetail["events"] };
type G = GalleryItem & { user_id: string };

const DAY = 86400000;
const ago = (d: number, h = 0) => new Date(Date.now() - d * DAY - h * 3600000).toISOString();
const ahead = (d: number) => new Date(Date.now() + d * DAY).toISOString();
let seq = 1000;
const uid = (p: string) => `${p}${++seq}`;

class DemoError extends Error {}
const fail = (m: string): never => { throw new DemoError(m); };

const DEFAULT_TIERS: T[] = [
  { name: "Эскиз", min_spent: 0, earn_pct: 3, pay_pct: 20, foreign_pct: 10, perks: "Базовый уровень с первого заказа", early_hours: 0 },
  { name: "Холст", min_spent: 10000, earn_pct: 5, pay_pct: 30, foreign_pct: 15, perks: "Приоритет в очереди", early_hours: 12 },
  { name: "Шедевр", min_spent: 30000, earn_pct: 8, pay_pct: 50, foreign_pct: 25, perks: "Ранний доступ к слотам · Скетч-бонус к заказу", early_hours: 24 },
];
const STAGES = ["Бриф", "Скетч", "Лайн", "Цвет", "Готово"];

function artist(id: string, nick: string, display_name: string, color: string, program_id: string, extra: Partial<A> = {}): A {
  return {
    id, nick, display_name, color, program_id, bio: "", foreign_mode: "by_tier", points_ttl_days: null, slots_mode: "unlimited",
    is_group_admin: false, tiers: DEFAULT_TIERS.map((t) => ({ ...t })), order_stages: [...STAGES], donate_links: [],
    donation_earn_pct: null, slots_total: 3, slots_opened_at: null, ...extra,
  };
}

// ---- мир демо ----

const ME: U = { id: "u_me", name: "Вы", username: "demo_artist", code: "KF-7Q2M" };
const users: U[] = [
  ME,
  { id: "u_anya", name: "Аня", username: "anya_draws", code: "KF-ANYA" },
  { id: "u_dima", name: "Дима", username: "dimasik", code: "KF-DIMA" },
  { id: "u_liza", name: "Лиза", username: null, code: "KF-LIZA" },
  { id: "u_shiro_u", name: "Широ", username: "shiro", code: "KF-SH7R" },
  { id: "u_new", name: "Вика", username: null, code: "KF-VIKA" },
];

const artists: A[] = [
  artist("a_me", "demo_artist", "Вы", "#E0B252", "p_mid", {
    is_group_admin: true, bio: "Персонажи, портреты, чиби", slots_mode: "open", slots_total: 4, slots_opened_at: ago(1),
    donate_links: [{ title: "Boosty", url: "https://boosty.to/" }], donation_earn_pct: 10,
  }),
  artist("a_shiro", "shiro", "Широ", "#9C8FD9", "p_mid", { bio: "Фоны и пейзажи", foreign_mode: "unlimited" }),
  artist("a_fox", "foxie", "Фокси", "#E07A52", "p_fox", { bio: "Стикеры и эмоуты", slots_mode: "open", slots_total: 2, slots_opened_at: ago(0, 3) }),
  artist("a_mira", "mira", "Мира", "#6FB39A", "p_fog", { bio: "Иллюстрации к историям", slots_mode: "rest" }),
  artist("a_oak", "oak", "Оук", "#C79B6B", "p_fog", { bio: "Референсы персонажей", foreign_mode: "unlimited" }),
];
artists[0].tiers[0].early_hours = 0;

const programs: { id: string; name: string; type: "group" | "solo"; slug: string; settings: ProgramSettingsData }[] = [
  { id: "p_mid", name: "Полночь", type: "group", slug: "polnoch", settings: defaultSettings(true) },
  { id: "p_fox", name: "Фокси", type: "solo", slug: "foxie", settings: defaultSettings(false) },
  { id: "p_fog", name: "Туман", type: "group", slug: "tuman", settings: defaultSettings(false) },
];
type ProgramSettingsData = {
  referral: { enabled: boolean; friend_bonus: number; referrer_bonus: number; min_order: number };
  birthday: { mode: "off" | "bonus" | "boost"; bonus: number; ttl_days: number; boost_pct: number; window_days: number };
};
function defaultSettings(on: boolean): ProgramSettingsData {
  return {
    referral: { enabled: on, friend_bonus: 100, referrer_bonus: 200, min_order: 1000 },
    birthday: { mode: on ? "bonus" : "off", bonus: 300, ttl_days: 14, boost_pct: 5, window_days: 3 },
  };
}

// участия: клиенты «Полночи» и вы — клиент Фокси и «Тумана»
const memberships: { user_id: string; program_id: string; joined_at: string }[] = [
  { user_id: "u_anya", program_id: "p_mid", joined_at: ago(60) },
  { user_id: "u_dima", program_id: "p_mid", joined_at: ago(40) },
  { user_id: "u_liza", program_id: "p_mid", joined_at: ago(5) },
  { user_id: "u_me", program_id: "p_fox", joined_at: ago(90) },
  { user_id: "u_me", program_id: "p_fog", joined_at: ago(30) },
];

const entries: E[] = [];
function addEntry(e: Partial<E> & { user_id: string; program_id: string; kind: Entry["kind"]; points: number }): E {
  const a = e.artist_id ? artists.find((x) => x.id === e.artist_id) : null;
  const full: E = {
    id: uid("e"), order_amount: 0, paid_amount: 0, earned: Math.max(e.points, 0), redeemed: 0, tier: null, source: "app",
    created_at: new Date().toISOString(), reversed: false, artist_nick: a?.nick ?? null, artist_id: null, order_id: null, ...e,
  };
  entries.unshift(full);
  return full;
}
function seedOp(user_id: string, artist_id: string, amount: number, redeem: number, daysAgo: number, source = "app") {
  const a = artists.find((x) => x.id === artist_id)!;
  const t = tierFor(a, spent(user_id, artist_id));
  const paid = amount - redeem;
  const earn = Math.floor((paid * t.earn_pct) / 100);
  addEntry({
    user_id, program_id: a.program_id, artist_id, kind: redeem ? "redeem" : "accrual", order_amount: amount, paid_amount: paid,
    earned: earn, redeemed: redeem, points: earn - redeem, tier: { name: t.name, earn_pct: t.earn_pct, pay_pct: t.pay_pct },
    created_at: ago(daysAgo), source,
  });
}
// история по возрастанию времени, чтобы уровни росли естественно
seedOp("u_anya", "a_me", 6000, 0, 58); seedOp("u_anya", "a_shiro", 8000, 0, 45); seedOp("u_anya", "a_me", 7000, 0, 30, "inline");
seedOp("u_anya", "a_me", 5000, 400, 12);
seedOp("u_dima", "a_me", 3500, 0, 38); seedOp("u_dima", "a_me", 4000, 0, 9, "inline");
seedOp("u_liza", "a_me", 2500, 0, 4);
seedOp("u_me", "a_fox", 9000, 0, 80); seedOp("u_me", "a_fox", 12000, 0, 50); seedOp("u_me", "a_fox", 6000, 300, 20);
seedOp("u_me", "a_mira", 15000, 0, 25); seedOp("u_me", "a_oak", 4000, 0, 6);
addEntry({ user_id: "u_me", program_id: "p_fog", kind: "gift", points: 1000, created_at: ago(3), source: "gift" });

const orders: O[] = [];
function seedOrder(artist_id: string, user_id: string, title: string, price: number | null, stage: number, daysAgo: number, status: O["status"] = "active"): O {
  const o: O = {
    id: uid("o"), artist_id, user_id, title, price, stages: [...STAGES], stage, status, created_at: ago(daysAgo), updated_at: ago(Math.max(daysAgo - 2, 0)),
    done_at: status === "done" ? ago(Math.max(daysAgo - 3, 0)) : null,
    events: [{ kind: "created", stage: 0, stage_name: STAGES[0], created_at: ago(daysAgo) }],
  };
  for (let i = 1; i <= stage; i++) o.events.push({ kind: i === STAGES.length - 1 ? "done" : "stage", stage: i, stage_name: STAGES[i], created_at: ago(daysAgo - i) });
  orders.unshift(o);
  return o;
}
seedOrder("a_me", "u_anya", "Портрет в полный рост", 7000, 3, 10);
seedOrder("a_me", "u_dima", "Чиби-пара", 4000, 1, 6);
seedOrder("a_me", "u_liza", "Аватарка", 2500, 4, 8, "done");
const myFox = seedOrder("a_fox", "u_me", "Пак стикеров (8 шт.)", 6000, 4, 22, "done");
const myMira = seedOrder("a_mira", "u_me", "Иллюстрация к главе", 15000, 2, 12);

const gallery: G[] = [];
function art(hue: number, shape: number): string {
  const c1 = `hsl(${hue} 60% 55%)`, c2 = `hsl(${(hue + 40) % 360} 55% 30%)`, c3 = `hsl(${(hue + 180) % 360} 70% 70%)`;
  const shapes = [
    `<circle cx="200" cy="170" r="90" fill="${c3}" opacity=".85"/><rect x="60" y="260" width="280" height="120" rx="60" fill="${c2}"/>`,
    `<path d="M40 360 L200 60 L360 360 Z" fill="${c3}" opacity=".8"/><circle cx="290" cy="110" r="36" fill="#fff" opacity=".7"/>`,
    `<path d="M0 300 Q100 220 200 300 T400 300 V400 H0Z" fill="${c2}"/><circle cx="120" cy="130" r="60" fill="${c3}"/>`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/>${shapes[shape % 3]}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function addArt(o: O, hue: number, shape: number, nsfw = false, daysAgo = 1) {
  const a = artists.find((x) => x.id === o.artist_id)!;
  gallery.unshift({
    id: uid("g"), path: "demo", url: art(hue, shape), nsfw, hidden: false, created_at: ago(daysAgo), order_id: o.id, order_title: o.title,
    artist: { id: a.id, nick: a.nick, color: a.color, display_name: a.display_name }, user_id: o.user_id,
  });
}
addArt(myFox, 20, 0, false, 18); addArt(myFox, 200, 1, false, 18); addArt(myFox, 320, 2, false, 17);
addArt(myMira, 150, 2, false, 5); addArt(myMira, 270, 0, true, 4);
addArt(orders.find((o) => o.title === "Аватарка")!, 40, 1, false, 5);

const slotRequests: { id: string; artist_id: string; user_id: string; comment: string; status: string; created_at: string }[] = [
  { id: "sr1", artist_id: "a_me", user_id: "u_anya", comment: "Хочу ещё одного персонажа, как в прошлый раз, но в зимнем наряде", status: "pending", created_at: ago(0, 2) },
];
const promotions: (Promotion & { artist_id: string })[] = [
  { id: "pr1", artist_id: "a_fox", title: "Неделя стикеров", multiplier: 2, starts_at: ago(1), ends_at: ahead(5) },
];
const certificates: (Certificate & { artist_id: string })[] = [
  {
    id: "c1", artist_id: "a_me", code: "G-7K3P9QXM", amount: 2000, status: "activated", note: "Дима дарит Лизе", scope: "artist", paid_via: "artist",
    expires_at: ahead(300), created_at: ago(7), activated_at: ago(5), activated_by: "Лиза",
    program: { id: "p_mid", name: "Полночь", type: "group" }, artist: { id: "a_me", nick: "demo_artist" },
  },
  {
    id: "c2", artist_id: "a_me", code: "G-DEMO2026", amount: 1500, status: "issued", note: "", scope: "group", paid_via: "artist",
    expires_at: ahead(365), created_at: ago(1), activated_at: null, activated_by: null,
    program: { id: "p_mid", name: "Полночь", type: "group" }, artist: { id: "a_me", nick: "demo_artist" },
  },
];
const fundraisers: (Fundraiser & { program_id: string })[] = [
  { id: "f1", program_id: "p_mid", title: "Стенд на фестивале", goal: 30000, raised: 12400, count: 9, status: "active" },
];
const state = { onboarded: { member: false, artist: false }, birth_day: null as number | null, birth_month: null as number | null };

// ---- расчёты ----

const artistOf = (id: string) => artists.find((a) => a.id === id) ?? fail("Художник не найден");
const myArtist = () => artists[0];
const programOf = (id: string) => programs.find((p) => p.id === id) ?? fail("Программа не найдена");
const userByCode = (code: string) => users.find((u) => u.code === code.toUpperCase()) ?? fail("Участник с таким кодом не найден");
const isMember = (user_id: string, program_id: string) => memberships.some((m) => m.user_id === user_id && m.program_id === program_id);

function spent(user_id: string, artist_id: string) {
  return entries.filter((e) => e.user_id === user_id && e.artist_id === artist_id && !e.reversed && (e.kind === "accrual" || e.kind === "redeem"))
    .reduce((s, e) => s + e.paid_amount, 0);
}
function balance(user_id: string, program_id: string) {
  return entries.filter((e) => e.user_id === user_id && e.program_id === program_id && !e.reversed).reduce((s, e) => s + e.points, 0);
}
function foreignBalance(user_id: string, a: A) {
  return entries.filter((e) => e.user_id === user_id && e.program_id === a.program_id && !e.reversed && e.points > 0 && e.artist_id && e.artist_id !== a.id)
    .reduce((s, e) => s + e.points, 0);
}
function tierFor(a: A, sp: number): T & { index: number } {
  let idx = 0;
  a.tiers.forEach((t, i) => { if (sp >= t.min_spent) idx = i; });
  return { ...a.tiers[idx], index: idx };
}
function tierInfo(user_id: string, a: A): TierInfo {
  const sp = spent(user_id, a.id);
  const t = tierFor(a, sp);
  const next = a.tiers[t.index + 1] ?? null;
  const progress = next ? Math.min(100, Math.round(((sp - t.min_spent) / (next.min_spent - t.min_spent)) * 100)) : 100;
  return {
    index: t.index, count: a.tiers.length, name: t.name, earn_pct: t.earn_pct, pay_pct: t.pay_pct, foreign_pct: t.foreign_pct, perks: t.perks,
    spent: sp, progress, next: next ? { name: next.name, min_spent: next.min_spent } : null,
  };
}
const artistPublic = (a: A): Artist => ({
  id: a.id, nick: a.nick, display_name: a.display_name, bio: a.bio, color: a.color, foreign_mode: a.foreign_mode,
  points_ttl_days: a.points_ttl_days, program_id: a.program_id, slots_mode: a.slots_mode, is_group_admin: a.is_group_admin,
});
function programInfo(id: string): Program {
  const p = programOf(id);
  return { id: p.id, name: p.name, type: p.type, slug: p.slug, artists: artists.filter((a) => a.program_id === id).map(artistPublic) };
}
const activePromo = (artist_id: string) => promotions.find((p) => p.artist_id === artist_id && new Date(p.starts_at) <= new Date() && new Date(p.ends_at) > new Date()) ?? null;

function slotsInfo(a: A, user_id: string): Slots {
  const taken = orders.filter((o) => o.artist_id === a.id && o.status === "active" && a.slots_opened_at && o.created_at >= a.slots_opened_at).length;
  const t = tierFor(a, spent(user_id, a.id));
  const maxEarly = Math.max(...a.tiers.map((x) => x.early_hours));
  const access = a.slots_opened_at ? new Date(new Date(a.slots_opened_at).getTime() + (maxEarly - t.early_hours) * 3600000).toISOString() : null;
  const pending = slotRequests.find((r) => r.artist_id === a.id && r.user_id === user_id && r.status === "pending")?.id ?? null;
  const mode = a.slots_mode ?? "unlimited";
  const free = mode === "open" ? Math.max(a.slots_total - taken, 0) : null;
  return {
    mode, total: a.slots_total, taken, free, opened_at: a.slots_opened_at, access_at: access, early_hours: t.early_hours,
    pending_request: pending,
    can_request: mode === "unlimited" || (mode === "open" && (free ?? 0) > 0 && (!access || new Date(access) <= new Date())),
  };
}

function quote(p: Record<string, unknown>, commit: boolean): Quote {
  const a = myArtist();
  const m = userByCode(String(p.code ?? ""));
  if (m.id === ME.id) fail("Нельзя начислять АРТы самому себе");
  const prog = programOf(a.program_id);
  const mode = String(p.mode) as "earn" | "redeem";
  let joining = false;
  if (!isMember(m.id, a.program_id)) {
    if (m.id === "u_shiro_u") fail("Художник не может быть участником программы своей группы");
    if (mode === "redeem") fail(`${m.name} ещё не в программе «${prog.name}», АРТов для оплаты нет`);
    joining = true;
  }
  const amount = Math.max(0, Math.trunc(Number(p.amount) || 0));
  if (amount <= 0) fail("Сумма должна быть больше нуля");
  const sp = spent(m.id, a.id);
  const t = tierFor(a, sp);
  const bal = balance(m.id, a.program_id);
  const foreign = foreignBalance(m.id, a);
  const own = Math.max(bal - foreign, 0);
  const payLimit = Math.floor((amount * t.pay_pct) / 100);
  const foreignCap = a.foreign_mode === "by_tier" ? Math.floor((amount * t.foreign_pct) / 100) : null;
  let max = 0;
  if (mode === "redeem") {
    const fromOwn = Math.min(own, payLimit);
    const fromForeign = Math.min(foreign, payLimit - fromOwn, foreignCap ?? Infinity);
    max = Math.max(fromOwn + fromForeign, 0);
  }
  const redeem = mode === "redeem" ? Math.min(p.redeem == null ? max : Math.max(Number(p.redeem), 0), max) : 0;
  if (commit && mode === "redeem" && p.redeem != null && Number(p.redeem) > max) fail(`Можно списать не больше ${max} АРТ`);
  const paid = amount - redeem;
  const promo = activePromo(a.id);
  const mult = promo ? Number(promo.multiplier) : 1;
  const earn = Math.floor((paid * t.earn_pct * mult) / 100);
  const nt = tierFor(a, sp + paid);
  const order = p.order_id ? orders.find((o) => o.id === p.order_id) ?? null : null;
  const q: Quote = {
    mode, amount, redeem, max_redeem: max, pay_limit: payLimit, foreign_cap: foreignCap, foreign_available: foreign, own_available: own,
    paid, earn, points: earn - redeem, balance_before: bal, balance_after: bal + earn - redeem, spent_after: sp + paid,
    tier: { index: t.index, name: t.name, earn_pct: t.earn_pct, pay_pct: t.pay_pct, foreign_pct: t.foreign_pct },
    new_tier: { index: nt.index, name: nt.name }, tier_up: nt.index > t.index,
    member: { name: m.name, code: m.code }, program: { name: prog.name, type: prog.type },
    multiplier: mult, promotion: promo, order: order ? { id: order.id, title: order.title } : null, joining,
    orders: orders.filter((o) => o.artist_id === a.id && o.user_id === m.id && o.status !== "cancelled")
      .map((o) => ({ id: o.id, title: o.title, price: o.price, stage_name: o.stages[o.stage] })),
  };
  if (commit) {
    if (joining) memberships.push({ user_id: m.id, program_id: a.program_id, joined_at: new Date().toISOString() });
    const e = addEntry({
      user_id: m.id, program_id: a.program_id, artist_id: a.id, kind: mode === "redeem" ? "redeem" : "accrual", order_amount: amount,
      paid_amount: paid, earned: earn, redeemed: redeem, points: earn - redeem, tier: { name: t.name, earn_pct: t.earn_pct, pay_pct: t.pay_pct },
      order_id: order?.id ?? null,
    });
    q.entry_id = e.id;
  }
  return q;
}

function orderJson(o: O): Order {
  const a = artistOf(o.artist_id);
  const u = users.find((x) => x.id === o.user_id)!;
  const pays = entries.filter((e) => e.order_id === o.id && !e.reversed);
  return {
    id: o.id, title: o.title, price: o.price, stages: o.stages, stage: o.stage, stage_name: o.stages[o.stage], status: o.status,
    created_at: o.created_at, updated_at: o.updated_at, done_at: o.done_at,
    paid: pays.reduce((s, e) => s + e.paid_amount, 0), redeemed: pays.reduce((s, e) => s + e.redeemed, 0),
    artist: { id: a.id, nick: a.nick, color: a.color, display_name: a.display_name }, member: { name: u.name, code: u.code },
  };
}
function orderDetail(o: O): OrderDetail {
  return {
    ...orderJson(o), is_artist: o.artist_id === myArtist().id, events: o.events,
    gallery: gallery.filter((g) => g.order_id === o.id), payments: entries.filter((e) => e.order_id === o.id),
  };
}
const certJson = ({ artist_id: _a, ...c }: Certificate & { artist_id: string }): Certificate => c;
function programSettings() {
  const a = myArtist();
  const p = programOf(a.program_id);
  const f = fundraisers.find((x) => x.program_id === p.id && x.status === "active") ?? null;
  return { program: programInfo(p.id), is_admin: !!a.is_group_admin, fundraiser: f, settings: p.settings };
}

function me(): Me {
  const a = myArtist();
  return {
    user: { id: ME.id, name: ME.name, username: ME.username, code: ME.code, birth_day: state.birth_day, birth_month: state.birth_month, has_referrer: false },
    onboarded: { ...state.onboarded },
    artist: { ...artistPublic(a), program: programInfo(a.program_id) },
    programs: memberships.filter((m) => m.user_id === ME.id).map((m) => {
      const info = programInfo(m.program_id);
      const tiers: Record<string, TierInfo> = {};
      artists.filter((x) => x.program_id === m.program_id).forEach((x) => { tiers[x.id] = tierInfo(ME.id, x); });
      return { ...info, balance: balance(ME.id, m.program_id), tiers, fundraiser: fundraisers.find((f) => f.program_id === m.program_id && f.status === "active") ?? null };
    }),
  };
}

// ---- действия ----

type P = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");

const handlers: Record<string, (p: P) => unknown> = {
  me,
  onboarded: (p) => { state.onboarded[s(p.role) as "member" | "artist"] = true; return { ok: true }; },
  set_referrer: () => ({ status: "invalid" }),

  preview_program: (p) => programInfo((programs.find((x) => x.slug === s(p.query).toLowerCase()) ?? fail("Программа не найдена")).id),
  join: (p) => {
    const prog = programs.find((x) => x.slug === s(p.query).toLowerCase()) ?? fail("Программа не найдена");
    if (prog.id === myArtist().program_id) fail("Художник не может быть участником программы своей группы");
    const joined = !isMember(ME.id, prog.id);
    if (joined) memberships.push({ user_id: ME.id, program_id: prog.id, joined_at: new Date().toISOString() });
    return { joined, program: programInfo(prog.id), balance: balance(ME.id, prog.id) };
  },
  leave: (p) => {
    const id = s(p.program_id);
    const bal = balance(ME.id, id);
    if (bal > 0) addEntry({ user_id: ME.id, program_id: id, kind: "forfeit", points: -bal, earned: 0 });
    const i = memberships.findIndex((m) => m.user_id === ME.id && m.program_id === id);
    if (i >= 0) memberships.splice(i, 1);
    return { forfeited: bal };
  },

  artist_card: (p) => {
    const a = artistOf(s(p.artist_id));
    return {
      artist: { ...artistPublic(a), donate_links: a.donate_links, donation_earn_pct: a.donation_earn_pct },
      slots: slotsInfo(a, ME.id), promotion: activePromo(a.id), is_member: isMember(ME.id, a.program_id),
      program: (({ id, name, type }) => ({ id, name, type }))(programOf(a.program_id)),
      tiers: a.tiers.map((t, index) => ({ index, ...t })), my_tier: tierInfo(ME.id, a),
      history: entries.filter((e) => e.user_id === ME.id && e.artist_id === a.id),
    };
  },
  history: (p) => ({
    program: programInfo(s(p.program_id)), balance: balance(ME.id, s(p.program_id)),
    history: entries.filter((e) => e.user_id === ME.id && e.program_id === s(p.program_id)),
  }),
  referrals: () => ({
    code: ME.code, invited: 2, rewarded: 1, earned: 200, bot: "artoki_bot",
    programs: memberships.filter((m) => m.user_id === ME.id).map((m) => ({ name: programOf(m.program_id).name, referral: programOf(m.program_id).settings.referral })),
  }),
  set_birthday: (p) => { state.birth_day = Number(p.day); state.birth_month = Number(p.month); return { ok: true }; },
  my_application: () => null,
  submit_application: () => fail("В демо заявки не отправляются"),
  accept_invite: () => fail("В демо приглашения не работают"),
  stars_invoice: () => fail("Оплата звёздами отключена"),

  quote: (p) => quote(p, false),
  commit: (p) => quote(p, true),
  donation: (p) => {
    const a = myArtist();
    const m = userByCode(s(p.code));
    const amount = Number(p.amount) || 0;
    const pts = a.donation_earn_pct ? Math.floor((amount * a.donation_earn_pct) / 100) : 0;
    addEntry({ user_id: m.id, program_id: a.program_id, artist_id: a.id, kind: "donation", order_amount: amount, points: pts });
    return { points: pts };
  },
  cancel: (p) => {
    const e = entries.find((x) => x.id === s(p.entry_id)) ?? fail("Операция не найдена");
    e.reversed = true;
    return { ok: true };
  },
  operations: () => {
    const a = myArtist();
    const items = entries.filter((e) => e.artist_id === a.id).map((e) => {
      const u = users.find((x) => x.id === e.user_id)!;
      return { ...e, member: { name: u.name, code: u.code }, can_cancel: !e.reversed && Date.now() - new Date(e.created_at).getTime() < 30 * DAY };
    });
    return { paid_total: items.filter((e) => !e.reversed).reduce((sum, e) => sum + e.paid_amount, 0), items };
  },
  clients: () => {
    const a = myArtist();
    return memberships.filter((m) => m.program_id === a.program_id).map((m) => {
      const u = users.find((x) => x.id === m.user_id)!;
      return { name: u.name, code: u.code, username: u.username, tier: tierInfo(u.id, a), balance: balance(u.id, a.program_id) };
    }).sort((x, y) => y.tier.spent - x.tier.spent);
  },
  settings: () => {
    const a = myArtist();
    return {
      artist: { ...artistPublic(a), order_stages: a.order_stages, donate_links: a.donate_links, donation_earn_pct: a.donation_earn_pct, slots_total: a.slots_total },
      program: programInfo(a.program_id), tiers: a.tiers as Tier[], slots: slotsInfo(a, "u_liza"),
    };
  },
  save_settings: (p) => {
    const a = myArtist();
    const tiers = (p.tiers as T[]) ?? [];
    if (!tiers.length) fail("Нужен хотя бы один уровень");
    tiers.forEach((t, i) => { if (i > 0 && t.min_spent <= tiers[i - 1].min_spent) fail("Пороги уровней должны расти"); });
    a.tiers = tiers.map((t) => ({ ...t }));
    const st = (p.settings ?? {}) as { foreign_mode?: A["foreign_mode"]; points_ttl_days?: number | ""; bio?: string };
    if (st.foreign_mode) a.foreign_mode = st.foreign_mode;
    a.points_ttl_days = st.points_ttl_days === "" || st.points_ttl_days == null ? null : Number(st.points_ttl_days);
    if (st.bio !== undefined) a.bio = st.bio;
    return { ok: true };
  },
  save_stages: (p) => { const st = (p.stages as string[]).filter(Boolean); if (st.length < 2) fail("Нужно хотя бы два этапа"); myArtist().order_stages = st; return st; },

  orders: () => orders.filter((o) => o.artist_id === myArtist().id).map(orderJson),
  my_orders: () => orders.filter((o) => o.user_id === ME.id).map(orderJson),
  order: (p) => orderDetail(orders.find((o) => o.id === s(p.order_id)) ?? fail("Заказ не найден")),
  create_order: (p) => {
    const m = userByCode(s(p.code));
    if (m.id === "u_shiro_u") fail("Художник не может быть участником программы своей группы");
    if (!s(p.title).trim()) fail("Название заказа — от 1 до 80 символов");
    if (!isMember(m.id, myArtist().program_id)) memberships.push({ user_id: m.id, program_id: myArtist().program_id, joined_at: new Date().toISOString() });
    const o: O = {
      id: uid("o"), artist_id: myArtist().id, user_id: m.id, title: s(p.title).trim(), price: p.price ? Number(p.price) : null,
      stages: (p.stages as string[] | null) ?? [...myArtist().order_stages], stage: 0, status: "active",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), done_at: null, events: [],
    };
    o.events.push({ kind: "created", stage: 0, stage_name: o.stages[0], created_at: o.created_at });
    orders.unshift(o);
    return orderJson(o);
  },
  set_stage: (p) => {
    const o = orders.find((x) => x.id === s(p.order_id)) ?? fail("Заказ не найден");
    const stage = Number(p.stage);
    const last = o.stages.length - 1;
    const kind = stage === last ? "done" : o.status === "done" ? "reopened" : "stage";
    o.stage = stage; o.status = stage === last ? "done" : "active"; o.done_at = stage === last ? new Date().toISOString() : null;
    o.updated_at = new Date().toISOString();
    o.events.push({ kind, stage, stage_name: o.stages[stage], created_at: o.updated_at });
    return orderDetail(o);
  },
  cancel_order: (p) => {
    const o = orders.find((x) => x.id === s(p.order_id)) ?? fail("Заказ не найден");
    o.status = "cancelled";
    o.events.push({ kind: "cancelled", stage: o.stage, stage_name: o.stages[o.stage], created_at: new Date().toISOString() });
    return orderJson(o);
  },

  gallery: () => gallery.filter((g) => g.user_id === ME.id),
  gallery_hide: (p) => { const g = gallery.find((x) => x.id === s(p.item_id)); if (g) g.hidden = !!p.hidden; return { ok: true }; },
  delete_art: (p) => { const i = gallery.findIndex((x) => x.id === s(p.item_id)); if (i >= 0) gallery.splice(i, 1); return { ok: true }; },

  request_slot: (p) => {
    const a = artistOf(s(p.artist_id));
    const sl = slotsInfo(a, ME.id);
    if (!sl.can_request) fail(a.slots_mode === "rest" ? "Художник сейчас отдыхает" : "Свободных слотов нет");
    slotRequests.push({ id: uid("sr"), artist_id: a.id, user_id: ME.id, comment: s(p.comment), status: "pending", created_at: new Date().toISOString() });
    return { ok: true };
  },
  withdraw_slot: (p) => { const r = slotRequests.find((x) => x.id === s(p.request_id)); if (r) r.status = "withdrawn"; return { ok: true }; },
  slot_requests: () => {
    const a = myArtist();
    return slotRequests.filter((r) => r.artist_id === a.id && r.status === "pending").map((r) => {
      const u = users.find((x) => x.id === r.user_id)!;
      return { id: r.id, comment: r.comment, created_at: r.created_at, member: { name: u.name, code: u.code }, tier: tierInfo(u.id, a) };
    });
  },
  decide_slot: (p) => {
    const r = slotRequests.find((x) => x.id === s(p.request_id)) ?? fail("Заявка не найдена");
    r.status = p.accept ? "accepted" : "declined";
    if (!p.accept) return { order: null };
    const u = users.find((x) => x.id === r.user_id)!;
    const o = handlers.create_order({ code: u.code, title: r.comment.slice(0, 60) || "Новый заказ", price: null, stages: null }) as Order;
    return { order: o };
  },
  set_slots: (p) => {
    const a = myArtist();
    const mode = s(p.mode) as A["slots_mode"];
    const announce = mode === "open" && (a.slots_mode !== "open" || Number(p.total) > a.slots_total);
    a.slots_mode = mode;
    a.slots_total = Math.max(1, Number(p.total) || 1);
    if (announce) a.slots_opened_at = new Date().toISOString();
    return { ...slotsInfo(a, "u_liza"), announce };
  },

  program_settings: programSettings,
  save_program_settings: (p) => { programOf(myArtist().program_id).settings = p.settings as ProgramSettingsData; return programSettings(); },
  create_fundraiser: (p) => {
    fundraisers.push({ id: uid("f"), program_id: myArtist().program_id, title: s(p.title), goal: Number(p.goal) || 1, raised: 0, count: 0, status: "active" });
    return programSettings();
  },
  close_fundraiser: () => { fundraisers.forEach((f) => { if (f.program_id === myArtist().program_id) f.status = "closed"; }); return programSettings(); },
  add_contribution: (p) => {
    const f = fundraisers.find((x) => x.program_id === myArtist().program_id && x.status === "active") ?? fail("Активного сбора нет");
    f.raised += Number(p.amount) || 0; f.count += 1;
    return programSettings();
  },

  save_donations: (p) => {
    const a = myArtist();
    a.donate_links = (p.links as A["donate_links"]).filter((l) => l.title && l.url);
    a.donation_earn_pct = p.pct == null || p.pct === "" ? null : Number(p.pct);
    return { ok: true };
  },
  promotions: () => promotions.filter((x) => x.artist_id === myArtist().id).map((x) => ({ ...x, active: activePromo(myArtist().id)?.id === x.id })),
  create_promotion: (p) => {
    if (!s(p.title).trim()) fail("Назовите акцию");
    promotions.push({ id: uid("pr"), artist_id: myArtist().id, title: s(p.title), multiplier: Number(p.multiplier), starts_at: s(p.starts_at), ends_at: s(p.ends_at) });
    return handlers.promotions({});
  },
  delete_promotion: (p) => { const i = promotions.findIndex((x) => x.id === s(p.id)); if (i >= 0) promotions.splice(i, 1); return handlers.promotions({}); },

  certificates: () => certificates.filter((c) => c.artist_id === myArtist().id).map(certJson),
  issue_certificate: (p) => {
    const a = myArtist();
    const amount = Number(p.amount) || 0;
    if (amount < 100) fail("Минимум 100 АРТ");
    const code = "G-" + Array.from({ length: 8 }, () => "23456789ABCDEFGHJKMNPQRSTUVWXYZ"[Math.floor(Math.random() * 31)]).join("");
    const c = {
      id: uid("c"), artist_id: a.id, code, amount, status: "issued" as const, note: s(p.note), scope: s(p.scope) as "artist" | "group", paid_via: "artist" as const,
      expires_at: ahead(365), created_at: new Date().toISOString(), activated_at: null, activated_by: null,
      program: (({ id, name, type }) => ({ id, name, type }))(programOf(a.program_id)), artist: { id: a.id, nick: a.nick },
    };
    certificates.unshift(c);
    const link = `https://t.me/artoki_bot?startapp=gift_${code}`;
    return { ...certJson(c), link, message: `Подарочный сертификат на ${amount} АРТ. Код: ${code}\nАктивировать: ${link}` };
  },
  void_certificate: (p) => { const c = certificates.find((x) => x.id === s(p.id)); if (c) c.status = "void"; return { ok: true }; },
  certificate_info: (p) => certJson(certificates.find((c) => c.code === s(p.code).toUpperCase()) ?? fail("Сертификат не найден")),
  activate_certificate: (p) => {
    const c = certificates.find((x) => x.code === s(p.code).toUpperCase()) ?? fail("Сертификат не найден");
    if (c.program.id === myArtist().program_id) fail("Художник не может активировать свой сертификат");
    fail("Сертификат уже активирован");
  },
};

export async function demoCall<R>(action: string, params: P): Promise<R> {
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  const h = handlers[action];
  if (!h) throw new Error("В демо это действие недоступно");
  try {
    return structuredClone(h(params)) as R;
  } catch (e) {
    if (e instanceof DemoError) throw new Error(e.message);
    console.error(action, e);
    throw new Error("Что-то пошло не так");
  }
}

export async function demoUpload(orderId: string, file: Blob, nsfw: boolean): Promise<GalleryItem> {
  const o = orders.find((x) => x.id === orderId) ?? fail("Заказ не найден");
  const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
  const a = artistOf(o.artist_id);
  const g: G = {
    id: uid("g"), path: "demo", url, nsfw, hidden: false, created_at: new Date().toISOString(), order_id: o.id, order_title: o.title,
    artist: { id: a.id, nick: a.nick, color: a.color, display_name: a.display_name }, user_id: o.user_id,
  };
  gallery.unshift(g);
  return structuredClone(g);
}
