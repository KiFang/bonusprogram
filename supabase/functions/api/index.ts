// API для Mini App. Каждый запрос подписан Telegram initData (заголовок X-Telegram-Init-Data).
import { AppError, rpc, upsertUser, type DbUser } from "../_shared/db.ts";
import { botApi, validateInitData } from "../_shared/telegram.ts";
import {
  cancelText, operationText, orderCancelText, orderCreatedText, orderStageText,
  type OperationResult, type OrderResult,
} from "../_shared/texts.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const tg = botApi(BOT_TOKEN);

const CORS = {
  "access-control-allow-origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "access-control-allow-headers": "content-type, x-telegram-init-data, apikey, authorization, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

async function notify(telegramId: number, text: string) {
  try {
    await tg("sendMessage", { chat_id: telegramId, text, parse_mode: "HTML" });
  } catch (e) {
    // Клиент мог ещё не запускать бота — это не ошибка операции.
    console.warn("notify failed", telegramId, String(e));
  }
}

const int = (v: unknown) => (v === null || v === undefined || v === "" ? null : Math.trunc(Number(v)));

type Handler = (me: DbUser, p: Record<string, unknown>) => Promise<unknown>;

const actions: Record<string, Handler> = {
  me: (me) => rpc("get_me", { p_user: me.id }),

  preview_program: async (_me, p) => {
    const id = await rpc<string | null>("resolve_program", { p_query: String(p.query ?? "") });
    if (!id) throw new AppError("Программа не найдена");
    return rpc("program_info", { p_program: id });
  },

  join: async (me, p) => {
    const id = await rpc<string | null>("resolve_program", { p_query: String(p.query ?? "") });
    if (!id) throw new AppError("Программа не найдена");
    return rpc("join_program", { p_user: me.id, p_program: id, p_source: String(p.source ?? "app") });
  },

  artist_card: (me, p) => rpc("get_artist_card", { p_user: me.id, p_artist: String(p.artist_id) }),
  history: (me, p) => rpc("get_program_history", { p_user: me.id, p_program: String(p.program_id) }),

  quote: (me, p) =>
    rpc("quote_operation", {
      p_artist_user: me.id, p_member_code: String(p.code ?? ""), p_mode: String(p.mode),
      p_amount: int(p.amount), p_redeem: int(p.redeem), p_order: p.order_id ? String(p.order_id) : null,
    }),

  commit: async (me, p) => {
    const r = await rpc<OperationResult>("commit_operation", {
      p_artist_user: me.id, p_member_code: String(p.code ?? ""), p_mode: String(p.mode),
      p_amount: int(p.amount), p_redeem: int(p.redeem), p_order: p.order_id ? String(p.order_id) : null,
    });
    await notify(r.member.telegram_id, operationText(r));
    return r;
  },

  cancel: async (me, p) => {
    const r = await rpc<Parameters<typeof cancelText>[0] & { member: { telegram_id: number } }>(
      "cancel_operation", { p_artist_user: me.id, p_entry: String(p.entry_id) });
    await notify(r.member.telegram_id, cancelText(r));
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
  order: (me, p) => rpc("get_order", { p_user: me.id, p_order: String(p.order_id) }),
  create_order: async (me, p) => {
    const stages = Array.isArray(p.stages) ? p.stages.map(String) : null;
    const o = await rpc<OrderResult & { member_telegram_id: number }>("create_order", {
      p_artist_user: me.id, p_member_code: String(p.code ?? ""), p_title: String(p.title ?? ""),
      p_price: int(p.price), p_stages: stages,
    });
    await notify(o.member_telegram_id, orderCreatedText(o));
    return o;
  },
  set_stage: async (me, p) => {
    const o = await rpc<OrderResult & { member_telegram_id: number }>("set_order_stage", {
      p_artist_user: me.id, p_order: String(p.order_id), p_stage: int(p.stage),
    });
    if (o.event) await notify(o.member_telegram_id, orderStageText(o));
    return o;
  },
  cancel_order: async (me, p) => {
    const o = await rpc<OrderResult & { member_telegram_id: number }>("cancel_order", {
      p_artist_user: me.id, p_order: String(p.order_id),
    });
    await notify(o.member_telegram_id, orderCancelText(o));
    return o;
  },
  save_stages: (me, p) =>
    rpc("save_order_stages", { p_artist_user: me.id, p_stages: Array.isArray(p.stages) ? p.stages.map(String) : [] }),

  accept_invite: (me, p) => rpc("accept_invite", { p_user: me.id, p_code: String(p.code ?? "") }),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!BOT_TOKEN) return json({ error: "Сервер ещё не настроен" }, 503);

  const auth = await validateInitData(req.headers.get("x-telegram-init-data") ?? "", BOT_TOKEN);
  if (!auth) return json({ error: "Откройте приложение из Telegram" }, 401);

  let body: { action?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Некорректный запрос" }, 400);
  }
  const handler = actions[body.action ?? ""];
  if (!handler) return json({ error: "Неизвестное действие" }, 400);

  try {
    const me = await upsertUser(auth.user);
    return json({ data: await handler(me, body.params ?? {}) });
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, 400);
    console.error(body.action, e);
    return json({ error: "Что-то пошло не так. Попробуйте ещё раз." }, 500);
  }
});
