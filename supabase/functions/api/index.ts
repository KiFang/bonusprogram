// API для Mini App. Каждый запрос подписан Telegram initData (заголовок X-Telegram-Init-Data).
import { AppError, ART_BUCKET, artistIdByUser, db, rpc, signArt, upsertUser, type DbUser } from "../_shared/db.ts";
import { botApi, STARS_ENABLED, validateInitData } from "../_shared/telegram.ts";
import {
  artAddedText, cancelText, donationText, esc, giftText, operationText, orderCancelText, orderCreatedText,
  orderStageText, referralFriendText, referralText, slotDecisionText, slotRequestText, slotsOpenedText,
  type OperationResult, type OrderResult,
} from "../_shared/texts.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const ADMINS = (Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const tg = botApi(BOT_TOKEN);
const MAX_UPLOAD = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const CORS = {
  "access-control-allow-origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "access-control-allow-headers": "content-type, x-telegram-init-data, apikey, authorization, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

async function notify(telegramId: number | null | undefined, text: string, extra: Record<string, unknown> = {}) {
  if (!telegramId) return;
  try {
    await tg("sendMessage", { chat_id: telegramId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  } catch (e) {
    // Человек мог ещё не запускать бота — это не ошибка операции.
    console.warn("notify failed", telegramId, String(e));
  }
}

let cachedUsername = Deno.env.get("BOT_USERNAME") ?? "";
async function botUsername(): Promise<string> {
  if (!cachedUsername) cachedUsername = (await tg<{ username: string }>("getMe")).username;
  return cachedUsername;
}

const int = (v: unknown) => (v === null || v === undefined || v === "" ? null : Math.trunc(Number(v)));
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const orNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

type Referral = { friend_bonus: number; referrer_bonus: number; referrer_telegram_id: number; friend_name: string; program: string } | null;

async function afterOperation(r: OperationResult & { referral?: Referral }) {
  await notify(r.member.telegram_id, operationText(r));
  if (r.referral) {
    if (r.referral.referrer_bonus > 0) await notify(r.referral.referrer_telegram_id, referralText(r.referral));
    if (r.referral.friend_bonus > 0) await notify(r.member.telegram_id, referralFriendText(r.referral));
  }
}

type Cert = { code: string; amount: number; scope: "artist" | "group"; program: { name: string }; artist: { nick: string } | null };
async function certMessage(c: Cert) {
  const where = c.scope === "group" ? `группа «${c.program.name}»` : `@${c.artist?.nick}`;
  return giftText(c.code, c.amount, where, `https://t.me/${await botUsername()}?startapp=gift_${c.code}`);
}

type Handler = (me: DbUser, p: Record<string, unknown>) => Promise<unknown>;

const actions: Record<string, Handler> = {
  me: (me) => rpc("get_me", { p_user: me.id }),

  // ---- вступление и выход ----
  preview_program: async (_me, p) => {
    const id = await rpc<string | null>("resolve_program", { p_query: str(p.query) });
    if (!id) throw new AppError("Программа не найдена");
    return rpc("program_info", { p_program: id });
  },
  join: async (me, p) => {
    const id = await rpc<string | null>("resolve_program", { p_query: str(p.query) });
    if (!id) throw new AppError("Программа не найдена");
    return rpc("join_program", { p_user: me.id, p_program: id, p_source: str(p.source) || "app" });
  },
  leave: (me, p) => rpc("leave_program", { p_user: me.id, p_program: str(p.program_id) }),

  // ---- экраны участника ----
  artist_card: (me, p) => rpc("get_artist_card", { p_user: me.id, p_artist: str(p.artist_id) }),
  history: (me, p) => rpc("get_program_history", { p_user: me.id, p_program: str(p.program_id) }),
  set_referrer: (me, p) => rpc("set_referrer", { p_user: me.id, p_code: str(p.code) }),
  referrals: async (me) => ({ ...(await rpc<Record<string, unknown>>("my_referrals", { p_user: me.id })), bot: await botUsername() }),
  set_birthday: (me, p) => rpc("set_birthday", { p_user: me.id, p_day: int(p.day), p_month: int(p.month) }),

  // ---- касса ----
  quote: (me, p) =>
    rpc("quote_operation", {
      p_artist_user: me.id, p_member_code: str(p.code), p_mode: str(p.mode),
      p_amount: int(p.amount), p_redeem: int(p.redeem), p_order: orNull(p.order_id),
    }),
  commit: async (me, p) => {
    const r = await rpc<OperationResult & { referral?: Referral }>("commit_operation", {
      p_artist_user: me.id, p_member_code: str(p.code), p_mode: str(p.mode),
      p_amount: int(p.amount), p_redeem: int(p.redeem), p_order: orNull(p.order_id),
    });
    await afterOperation(r);
    return r;
  },
  cancel: async (me, p) => {
    const r = await rpc<Parameters<typeof cancelText>[0] & { member: { telegram_id: number } }>(
      "cancel_operation", { p_artist_user: me.id, p_entry: str(p.entry_id) });
    await notify(r.member.telegram_id, cancelText(r));
    return r;
  },
  donation: async (me, p) => {
    const r = await rpc<Parameters<typeof donationText>[0] & { member: { telegram_id: number } }>(
      "record_donation", { p_artist_user: me.id, p_member_code: str(p.code), p_amount: int(p.amount) });
    await notify(r.member.telegram_id, donationText(r));
    return r;
  },

  operations: (me) => rpc("artist_operations", { p_artist_user: me.id }),
  clients: (me) => rpc("artist_clients", { p_artist_user: me.id }),
  settings: (me) => rpc("get_artist_settings", { p_artist_user: me.id }),
  save_settings: (me, p) =>
    rpc("save_artist_settings", { p_artist_user: me.id, p_tiers: p.tiers ?? [], p_settings: p.settings ?? {} }),

  // ---- заказы ----
  orders: (me) => rpc("artist_orders", { p_artist_user: me.id }),
  my_orders: (me) => rpc("member_orders", { p_user: me.id }),
  order: async (me, p) => {
    const o = await rpc<{ gallery: { path: string }[] }>("get_order", { p_user: me.id, p_order: str(p.order_id) });
    return { ...o, gallery: await signArt(o.gallery) };
  },
  create_order: async (me, p) => {
    const stages = Array.isArray(p.stages) ? p.stages.map(String) : null;
    const o = await rpc<OrderResult & { member_telegram_id: number }>("create_order", {
      p_artist_user: me.id, p_member_code: str(p.code), p_title: str(p.title), p_price: int(p.price), p_stages: stages,
    });
    await notify(o.member_telegram_id, orderCreatedText(o));
    return o;
  },
  set_stage: async (me, p) => {
    const o = await rpc<OrderResult & { member_telegram_id: number }>("set_order_stage", {
      p_artist_user: me.id, p_order: str(p.order_id), p_stage: int(p.stage),
    });
    if (o.event) await notify(o.member_telegram_id, orderStageText(o));
    return o;
  },
  cancel_order: async (me, p) => {
    const o = await rpc<OrderResult & { member_telegram_id: number }>("cancel_order", {
      p_artist_user: me.id, p_order: str(p.order_id),
    });
    await notify(o.member_telegram_id, orderCancelText(o));
    return o;
  },
  save_stages: (me, p) =>
    rpc("save_order_stages", { p_artist_user: me.id, p_stages: Array.isArray(p.stages) ? p.stages.map(String) : [] }),

  // ---- коллекция ----
  gallery: async (me) => signArt(await rpc<{ path: string }[]>("member_gallery", { p_user: me.id })),
  gallery_hide: (me, p) => rpc("set_gallery_hidden", { p_user: me.id, p_item: str(p.item_id), p_hidden: !!p.hidden }),
  delete_art: async (me, p) => {
    const path = await rpc<string>("delete_gallery_item", { p_artist_user: me.id, p_item: str(p.item_id) });
    await db.storage.from(ART_BUCKET).remove([path]);
    return { ok: true };
  },

  // ---- слоты ----
  request_slot: async (me, p) => {
    const r = await rpc<Parameters<typeof slotRequestText>[0] & { artist_telegram_id: number }>(
      "request_slot", { p_user: me.id, p_artist: str(p.artist_id), p_comment: str(p.comment) });
    await notify(r.artist_telegram_id, slotRequestText(r));
    return r;
  },
  withdraw_slot: (me, p) => rpc("withdraw_slot_request", { p_user: me.id, p_request: str(p.request_id) }),
  slot_requests: (me) => rpc("artist_slot_requests", { p_artist_user: me.id }),
  decide_slot: async (me, p) => {
    const r = await rpc<{ status: string; order: OrderResult | null; member_telegram_id: number; artist: { nick: string } }>(
      "decide_slot_request", {
        p_artist_user: me.id, p_request: str(p.request_id), p_accept: !!p.accept, p_title: str(p.title), p_price: int(p.price),
      });
    await notify(r.member_telegram_id, slotDecisionText(r.artist.nick, r.status === "accepted", r.order?.title));
    return r;
  },
  set_slots: async (me, p) => {
    const r = await rpc<{ announce: boolean; free: number | null; artist: { nick: string }; notify: { telegram_id: number; access_at: string | null }[] }>(
      "set_slots", { p_artist_user: me.id, p_mode: str(p.mode), p_total: int(p.total) });
    if (r.announce) {
      for (const n of r.notify.slice(0, 500)) await notify(n.telegram_id, slotsOpenedText(r.artist.nick, r.free, n.access_at));
    }
    return { ...r, notify: undefined };
  },

  // ---- программа (админ группы) ----
  program_settings: (me) => rpc("get_program_settings", { p_artist_user: me.id }),
  save_program_settings: (me, p) => rpc("save_program_settings", { p_artist_user: me.id, p_settings: p.settings ?? {} }),
  create_fundraiser: (me, p) => rpc("create_fundraiser", { p_artist_user: me.id, p_title: str(p.title), p_goal: int(p.goal) }),
  close_fundraiser: (me) => rpc("close_fundraiser", { p_artist_user: me.id }),
  add_contribution: (me, p) => rpc("add_contribution", { p_artist_user: me.id, p_amount: int(p.amount), p_note: str(p.note) }),

  // ---- донаты и акции ----
  save_donations: (me, p) =>
    rpc("save_donation_settings", { p_artist_user: me.id, p_links: p.links ?? [], p_pct: p.pct === null || p.pct === "" || p.pct === undefined ? null : Number(p.pct) }),
  promotions: (me) => rpc("artist_promotions", { p_artist_user: me.id }),
  create_promotion: (me, p) =>
    rpc("create_promotion", {
      p_artist_user: me.id, p_title: str(p.title), p_multiplier: Number(p.multiplier), p_starts: str(p.starts_at), p_ends: str(p.ends_at),
    }),
  delete_promotion: (me, p) => rpc("delete_promotion", { p_artist_user: me.id, p_id: str(p.id) }),

  // ---- сертификаты ----
  certificates: (me) => rpc("artist_certificates", { p_artist_user: me.id }),
  issue_certificate: async (me, p) => {
    const c = await rpc<Cert>("issue_certificate", { p_artist_user: me.id, p_scope: str(p.scope), p_amount: int(p.amount), p_note: str(p.note) });
    return { ...c, message: await certMessage(c), link: `https://t.me/${await botUsername()}?startapp=gift_${c.code}` };
  },
  void_certificate: (me, p) => rpc("void_certificate", { p_artist_user: me.id, p_id: str(p.id) }),
  certificate_info: (_me, p) => rpc("certificate_info", { p_code: str(p.code) }),
  activate_certificate: (me, p) => rpc("activate_certificate", { p_user: me.id, p_code: str(p.code) }),

  // ---- оплата Stars ----
  stars_invoice: async (me, p) => {
    if (!STARS_ENABLED) throw new AppError("Оплата звёздами отключена. Оплатите напрямую художнику.");
    const inv = await rpc<{ id: string; stars: number; title: string; description: string }>("create_stars_invoice", {
      p_user: me.id, p_kind: str(p.kind), p_target: str(p.target_id), p_scope: orNull(p.scope), p_arts: int(p.arts),
    });
    const link = await tg<string>("createInvoiceLink", {
      title: inv.title, description: inv.description, payload: inv.id, currency: "XTR",
      prices: [{ label: inv.title, amount: inv.stars }],
    });
    return { link, stars: inv.stars };
  },

  // ---- стать художником ----
  accept_invite: (me, p) => rpc("accept_invite", { p_user: me.id, p_code: str(p.code) }),
  my_application: (me) => rpc("my_application", { p_user: me.id }),
  submit_application: async (me, p) => {
    const x = await rpc<{ id: string; about: string; links: string; desired: string; user: { name: string; username: string } }>(
      "submit_application", { p_user: me.id, p_about: str(p.about), p_links: str(p.links), p_desired: str(p.desired) });
    const text = `Заявка художника: <b>${esc(x.user.name)}</b> @${esc(x.user.username)}\n` +
      `Куда: ${x.desired === "solo" ? "соло" : `группа ${esc(x.desired)}`}\n\n${esc(x.about)}` + (x.links ? `\n\n${esc(x.links)}` : "");
    for (const admin of ADMINS) {
      await notify(Number(admin), text, {
        reply_markup: { inline_keyboard: [[{ text: "Принять", callback_data: `ap:y:${x.id}` }, { text: "Отклонить", callback_data: `ap:n:${x.id}` }]] },
      });
    }
    return x;
  },
};

// Загрузка арта к заказу: multipart/form-data с полями order_id, nsfw, file.
async function uploadArt(me: DbUser, form: FormData) {
  const artistId = await artistIdByUser(me.id);
  if (!artistId) throw new AppError("Загружать арты могут художники");
  const file = form.get("file");
  const orderId = str(form.get("order_id"));
  if (!(file instanceof File)) throw new AppError("Файл не получен");
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new AppError("Подходят JPEG, PNG или WebP");
  if (file.size > MAX_UPLOAD) throw new AppError("Файл больше 8 МБ");
  if (!/^[0-9a-f-]{36}$/.test(orderId)) throw new AppError("Некорректный заказ");
  const path = `${artistId}/${orderId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(ART_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error(`upload: ${error.message}`);
  try {
    const item = await rpc<{ member_telegram_id: number; order_title: string; artist_nick: string; path: string }>(
      "add_gallery_item", { p_artist_user: me.id, p_order: orderId, p_path: path, p_nsfw: form.get("nsfw") === "true" });
    await notify(item.member_telegram_id, artAddedText(item.artist_nick, item.order_title));
    return (await signArt([item]))[0];
  } catch (e) {
    await db.storage.from(ART_BUCKET).remove([path]);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!BOT_TOKEN) return json({ error: "Сервер ещё не настроен" }, 503);

  const auth = await validateInitData(req.headers.get("x-telegram-init-data") ?? "", BOT_TOKEN);
  if (!auth) return json({ error: "Откройте приложение из Telegram" }, 401);

  const isUpload = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  let action = "upload_art";
  let params: Record<string, unknown> = {};
  let form: FormData | null = null;
  try {
    if (isUpload) form = await req.formData();
    else ({ action = "", params = {} } = await req.json());
  } catch {
    return json({ error: "Некорректный запрос" }, 400);
  }
  const handler = actions[action];
  if (!isUpload && !handler) return json({ error: "Неизвестное действие" }, 400);

  try {
    const me = await upsertUser(auth.user);
    const data = isUpload ? await uploadArt(me, form!) : await handler(me, params);
    return json({ data });
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, 400);
    console.error(action, e);
    return json({ error: "Что-то пошло не так. Попробуйте ещё раз." }, 500);
  }
});

