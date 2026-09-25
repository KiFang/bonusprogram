// Webhook бота Артоки: команды, inline-начисление, кнопка «Забрать АРТы».
import { AppError, artistByTelegramId, rpc, upsertUser } from "../_shared/db.ts";
import { botApi, signClaim, verifyClaim, type TgUser } from "../_shared/telegram.ts";
import { esc, fmt, HELP, joinText, operationText, WELCOME, type OperationResult } from "../_shared/texts.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const APP_URL = Deno.env.get("APP_URL") ?? "";
const ADMINS = new Set((Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const tg = botApi(BOT_TOKEN);

const MAX_AMOUNT = 10_000_000;

function appButton(text: string, startParam?: string) {
  if (!APP_URL) return undefined;
  const url = startParam ? `${APP_URL}?tgWebAppStartParam=${encodeURIComponent(startParam)}` : APP_URL;
  return { inline_keyboard: [[{ text, web_app: { url } }]] };
}

async function reply(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}

// ---- команды ----

async function joinByQuery(chatId: number, from: TgUser, query: string) {
  const me = await upsertUser(from);
  const programId = await rpc<string | null>("resolve_program", { p_query: query });
  if (!programId) {
    await reply(chatId, `Не нашёл программу «${esc(query)}». Проверьте название группы или ник художника.`);
    return;
  }
  const r = await rpc<{ joined: boolean; program: Parameters<typeof joinText>[0]; balance: number }>(
    "join_program", { p_user: me.id, p_program: programId, p_source: "command" });
  await reply(chatId, joinText(r.program, r.joined, r.balance), { reply_markup: appButton("Открыть кошелёк") });
}

async function onMessage(msg: { chat: { id: number; type: string }; from?: TgUser; text?: string }) {
  if (!msg.from || !msg.text || msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const [rawCmd, ...rest] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, "");
  const arg = rest.join(" ").trim();
  const isAdmin = ADMINS.has(String(msg.from.id));

  switch (cmd) {
    case "/start": {
      const me = await upsertUser(msg.from);
      if (arg.startsWith("j_")) return joinByQuery(chatId, msg.from, arg.slice(2));
      if (arg.startsWith("inv_")) {
        const r = await rpc<{ program: { name: string; type: string } }>("accept_invite", { p_user: me.id, p_code: arg.slice(4) });
        return reply(chatId,
          `Готово, вы художник Артоки в программе «${esc(r.program.name)}».\nОткройте приложение, чтобы настроить уровни. В переписке с клиентом наберите <code>@${await botUsername()} 3000</code>, чтобы начислить АРТы.`,
          { reply_markup: appButton("Открыть кассу") });
      }
      return reply(chatId, `Привет, ${esc(msg.from.first_name)}! ${WELCOME}\n\nВаш код участника: <code>${me.member_code}</code>`,
        { reply_markup: appButton("Открыть кошелёк") });
    }
    case "/bonusp":
      if (!arg) return reply(chatId, "Напишите, к кому присоединиться. Например: /bonusp Полночь или /bonusp @nick");
      return joinByQuery(chatId, msg.from, arg);
    case "/balance": {
      const me = await upsertUser(msg.from);
      const data = await rpc<{ programs: { name: string; balance: number }[] }>("get_me", { p_user: me.id });
      if (!data.programs.length) return reply(chatId, "Вы пока не состоите ни в одной программе. Отправьте /bonusp &lt;группа или ник&gt;.");
      return reply(chatId, data.programs.map((p) => `«${esc(p.name)}»: <b>${fmt(p.balance)} АРТ</b>`).join("\n"),
        { reply_markup: appButton("Открыть кошелёк") });
    }
    case "/app":
      return reply(chatId, "Ваш кошелёк Артоки:", { reply_markup: appButton("Открыть") });
    case "/help":
      return reply(chatId, HELP.replace("@бот", "@" + (await botUsername())));

    // ---- администрирование ----
    case "/newgroup": {
      if (!isAdmin) break;
      const [slug, ...name] = arg.split(/\s+/);
      if (!slug || !name.length) return reply(chatId, "Формат: /newgroup &lt;адрес&gt; &lt;Название&gt;\nНапример: /newgroup polnoch Полночь");
      const p = await rpc<{ name: string; slug: string }>("create_group", { p_name: name.join(" "), p_slug: slug });
      return reply(chatId, `Группа «${esc(p.name)}» создана. Пригласить художника: /invite ${esc(p.slug)}`);
    }
    case "/invite": {
      if (!isAdmin) break;
      const r = await rpc<{ code: string; program: { name: string } | null }>(
        "create_invite", { p_admin_tg: msg.from.id, p_program_slug: arg || null });
      const link = `https://t.me/${await botUsername()}?start=inv_${r.code}`;
      return reply(chatId,
        `Приглашение ${r.program ? `в группу «${esc(r.program.name)}»` : "для соло-художника"} на 14 дней:\n${link}\n\nОтправьте ссылку художнику. Ссылка одноразовая.`);
    }
  }
  if (cmd.startsWith("/")) return reply(chatId, "Не понял команду. Список команд: /help");
}

// ---- inline: художник набирает «@бот 3000» в переписке с клиентом ----

async function onInlineQuery(q: { id: string; from: TgUser; query: string }) {
  const artist = await artistByTelegramId(q.from.id);
  const amount = Number(q.query.replace(/[^\d]/g, ""));
  if (!artist) {
    await tg("answerInlineQuery", {
      inline_query_id: q.id, results: [], cache_time: 30, is_personal: true,
      button: { text: "Начислять АРТы могут художники Артоки", start_parameter: "inline" },
    });
    return;
  }
  if (!amount || amount > MAX_AMOUNT) {
    await tg("answerInlineQuery", {
      inline_query_id: q.id, results: [], cache_time: 0, is_personal: true,
      button: { text: "Введите сумму заказа, например 3000", start_parameter: "inline" },
    });
    return;
  }
  const data = await signClaim(WEBHOOK_SECRET, q.from.id, amount);
  await tg("answerInlineQuery", {
    inline_query_id: q.id, cache_time: 0, is_personal: true,
    results: [{
      type: "article",
      id: `a${amount}`,
      title: `Начислить АРТы за заказ на ${fmt(amount)} ₽`,
      description: "Клиент нажмёт кнопку, и АРТы начислятся по его уровню",
      input_message_content: {
        message_text: `<b>Заказ у @${esc(artist.nick)} на ${fmt(amount)} ₽</b>\nНажмите кнопку, чтобы получить АРТы по вашему уровню. Кнопка действует 48 часов.`,
        parse_mode: "HTML",
      },
      reply_markup: { inline_keyboard: [[{ text: "Забрать АРТы", callback_data: data }]] },
    }],
  });
}

async function onCallback(cb: { id: string; from: TgUser; data?: string; inline_message_id?: string }) {
  const answer = (text: string, alert = true) => tg("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert });
  if (!cb.data || !cb.inline_message_id) return answer("Кнопка устарела");
  const claim = await verifyClaim(WEBHOOK_SECRET, cb.data);
  if (claim === "expired") return answer("Срок кнопки истёк. Попросите художника отправить новую.");
  if (!claim) return answer("Кнопка недействительна");
  if (claim.artistTgId === cb.from.id) return answer("Эту кнопку нажимает клиент, а не художник");

  const artist = await artistByTelegramId(claim.artistTgId);
  if (!artist) return answer("Художник больше не участвует в программе");
  const me = await upsertUser(cb.from);
  try {
    const r = await rpc<OperationResult>("claim_inline", {
      p_ref: cb.inline_message_id, p_artist: artist.id, p_member: me.id, p_amount: claim.amount,
    });
    await tg("editMessageText", {
      inline_message_id: cb.inline_message_id, parse_mode: "HTML",
      text: `<b>Заказ у @${esc(artist.nick)} на ${fmt(claim.amount)} ₽</b>\n${esc(r.member.name)}: +${fmt(r.earn)} АРТ · ${esc(r.tier.name)} ${Number(r.tier.earn_pct)}%`,
    });
    await answer(`+${fmt(r.earn)} АРТ зачислено в «${r.program.name}». Баланс: ${fmt(r.balance_after)} АРТ`);
    try {
      await reply(cb.from.id, operationText(r), { reply_markup: appButton("Открыть кошелёк") });
    } catch {
      // клиент ещё не запускал бота
    }
  } catch (e) {
    if (e instanceof AppError) return answer(e.message);
    throw e;
  }
}

// ---- служебное ----

let cachedUsername = Deno.env.get("BOT_USERNAME") ?? "";
async function botUsername(): Promise<string> {
  if (!cachedUsername) cachedUsername = (await tg<{ username: string }>("getMe")).username;
  return cachedUsername;
}

async function setup(url: URL) {
  const hook = `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot`;
  await tg("setWebhook", {
    url: hook, secret_token: WEBHOOK_SECRET, drop_pending_updates: true,
    allowed_updates: ["message", "inline_query", "callback_query"],
  });
  await tg("setMyCommands", {
    commands: [
      { command: "bonusp", description: "Вступить в программу художника или группы" },
      { command: "balance", description: "Баланс АРТов" },
      { command: "app", description: "Открыть кошелёк" },
      { command: "help", description: "Помощь" },
    ],
  });
  if (APP_URL) {
    await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Артоки", web_app: { url: APP_URL } } });
  }
  return { webhook: hook, app: APP_URL || null, bot: await botUsername(), host: url.host };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("setup")) {
    if (url.searchParams.get("setup") !== WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
    try {
      return Response.json(await setup(url));
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  }
  if (req.method !== "POST" || req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await req.json();
  try {
    if (update.message) await onMessage(update.message);
    else if (update.inline_query) await onInlineQuery(update.inline_query);
    else if (update.callback_query) await onCallback(update.callback_query);
  } catch (e) {
    const chatId = update.message?.chat?.id;
    if (e instanceof AppError && chatId) await reply(chatId, esc(e.message)).catch(() => {});
    else console.error("update failed", e);
  }
  // Telegram должен получить 200, иначе будет повторять обновление.
  return new Response("ok");
});
