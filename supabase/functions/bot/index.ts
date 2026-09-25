// Webhook бота Артоки: команды, inline-начисление, Stars, Telegram Business, заявки художников, расписание.
import { AppError, artistByTelegramId, rpc, upsertUser } from "../_shared/db.ts";
import { botApi, signClaim, verifyClaim, type TgUser } from "../_shared/telegram.ts";
import {
  birthdayText, donationText, esc, fmt, giftText, HELP, joinText, operationText, referralFriendText, referralText, WELCOME,
  type OperationResult,
} from "../_shared/texts.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const APP_URL = Deno.env.get("APP_URL") ?? "";
const ADMINS = new Set((Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const tg = botApi(BOT_TOKEN);

const MAX_AMOUNT = 10_000_000;

type Referral = { friend_bonus: number; referrer_bonus: number; referrer_telegram_id: number; friend_name: string; program: string } | null;

function appButton(text: string, startParam?: string) {
  if (!APP_URL) return undefined;
  const url = startParam ? `${APP_URL}?tgWebAppStartParam=${encodeURIComponent(startParam)}` : APP_URL;
  return { inline_keyboard: [[{ text, web_app: { url } }]] };
}

async function reply(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}

async function tell(chatId: number | null | undefined, text: string, extra: Record<string, unknown> = {}) {
  if (!chatId) return;
  try {
    await reply(chatId, text, extra);
  } catch {
    // человек ещё не запускал бота
  }
}

async function afterOperation(r: OperationResult & { referral?: Referral }) {
  await tell(r.member.telegram_id, operationText(r), { reply_markup: appButton("Открыть кошелёк") });
  if (r.referral) {
    if (r.referral.referrer_bonus > 0) await tell(r.referral.referrer_telegram_id, referralText(r.referral));
    if (r.referral.friend_bonus > 0) await tell(r.member.telegram_id, referralFriendText(r.referral));
  }
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

async function activateGift(chatId: number, from: TgUser, code: string) {
  const me = await upsertUser(from);
  const c = await rpc<{ amount: number; program: { name: string }; balance_after: number; issuer_telegram_id: number | null }>(
    "activate_certificate", { p_user: me.id, p_code: code });
  await reply(chatId, `Сертификат активирован: <b>+${fmt(c.amount)} АРТ</b> в «${esc(c.program.name)}».\nБаланс: ${fmt(c.balance_after)} АРТ`,
    { reply_markup: appButton("Открыть кошелёк") });
  await tell(c.issuer_telegram_id, `${esc(from.first_name)} активировал(а) ваш сертификат на ${fmt(c.amount)} АРТ.`);
}

async function onMessage(msg: {
  chat: { id: number; type: string }; from?: TgUser; text?: string;
  successful_payment?: { invoice_payload: string; telegram_payment_charge_id: string; total_amount: number; currency: string };
}) {
  if (!msg.from || msg.chat.type !== "private") return;
  if (msg.successful_payment) return onPayment(msg.chat.id, msg.successful_payment);
  if (!msg.text) return;
  const chatId = msg.chat.id;
  const [rawCmd, ...rest] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, "");
  const arg = rest.join(" ").trim();
  const isAdmin = ADMINS.has(String(msg.from.id));

  switch (cmd) {
    case "/start": {
      const me = await upsertUser(msg.from);
      if (arg.startsWith("j_")) return joinByQuery(chatId, msg.from, arg.slice(2));
      if (arg.startsWith("gift_")) return activateGift(chatId, msg.from, arg.slice(5));
      if (arg.startsWith("inv_")) {
        const r = await rpc<{ program: { name: string; type: string } }>("accept_invite", { p_user: me.id, p_code: arg.slice(4) });
        return reply(chatId,
          `Готово, вы художник Артоки в программе «${esc(r.program.name)}».\nОткройте приложение, чтобы настроить уровни. В переписке с клиентом наберите <code>@${await botUsername()} 3000</code>, чтобы начислить АРТы.`,
          { reply_markup: appButton("Открыть кассу") });
      }
      if (arg.startsWith("ref_")) {
        const r = await rpc<{ status: string; referrer?: { name: string } }>("set_referrer", { p_user: me.id, p_code: arg.slice(4) });
        if (r.status === "ok") {
          await reply(chatId, `Вас пригласил(а) ${esc(r.referrer!.name)}. После первого заказа вы оба получите бонусные АРТы, если программа художника их выдаёт.`);
        }
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
    case "/gift":
      if (!arg) return reply(chatId, "Напишите код сертификата: /gift G-XXXXXXXX");
      return activateGift(chatId, msg.from, arg);
    case "/app":
      return reply(chatId, "Ваш кошелёк Артоки:", { reply_markup: appButton("Открыть") });
    case "/help":
      return reply(chatId, HELP.replace("@бот", "@" + (await botUsername())) +
        "\n/gift &lt;код&gt; — активировать подарочный сертификат" +
        "\n\nС Telegram Premium художник может подключить бота к бизнес-аккаунту и писать клиенту <code>/addart 3000</code> прямо в переписке.");

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
    case "/payouts": {
      if (!isAdmin) break;
      const list = await rpc<{ who: string; stars: number; arts: number; count: number }[]>("stars_payouts");
      if (!list.length) return reply(chatId, "Невыплаченных звёзд нет.");
      return reply(chatId, "К выплате (звёзды пришли на бота):\n\n" +
        list.map((x) => `${esc(x.who)}: <b>${fmt(x.stars)} ★</b> (${fmt(x.arts)} ₽, платежей: ${x.count})`).join("\n") +
        "\n\nПосле выплаты: /paid &lt;ник художника или адрес группы&gt;");
    }
    case "/paid": {
      if (!isAdmin) break;
      if (!arg) return reply(chatId, "Формат: /paid &lt;ник художника или адрес группы&gt;");
      const n = await rpc<number>("mark_stars_paid", { p_who: arg });
      return reply(chatId, n ? `Отмечено выплаченными: ${n}` : "Невыплаченных платежей для этого получателя нет.");
    }
  }
  if (cmd.startsWith("/")) return reply(chatId, "Не понял команду. Список команд: /help");
}

// ---- оплата Stars ----

async function onPreCheckout(q: { id: string; from: TgUser; currency: string; total_amount: number; invoice_payload: string }) {
  let ok = false;
  try {
    ok = q.currency === "XTR" && await rpc<boolean>("check_stars_invoice", {
      p_id: q.invoice_payload, p_stars: q.total_amount, p_payer_tg: q.from.id,
    });
  } catch {
    ok = false;
  }
  await tg("answerPreCheckoutQuery", ok
    ? { pre_checkout_query_id: q.id, ok: true }
    : { pre_checkout_query_id: q.id, ok: false, error_message: "Счёт устарел. Откройте оплату в приложении заново." });
}

async function onPayment(chatId: number, pay: { invoice_payload: string; telegram_payment_charge_id: string; total_amount: number }) {
  const r = await rpc<{ kind: string; arts: number; stars: number; duplicate?: boolean; data: Record<string, unknown>; artist_telegram_id: number | null }>(
    "complete_stars_invoice", { p_id: pay.invoice_payload, p_charge_id: pay.telegram_payment_charge_id, p_stars: pay.total_amount });
  if (r.duplicate) return;
  if (r.kind === "certificate") {
    const c = r.data as { code: string; amount: number; scope: string; program: { name: string }; artist: { nick: string } | null };
    const where = c.scope === "group" ? `группа «${c.program.name}»` : `@${c.artist?.nick}`;
    await reply(chatId, "Оплата прошла. Вот ваш сертификат:");
    await reply(chatId, giftText(c.code, c.amount, where, `https://t.me/${await botUsername()}?startapp=gift_${c.code}`));
    await tell(r.artist_telegram_id, `Куплен сертификат на ${fmt(c.amount)} АРТ за ${fmt(r.stars)} ★.`);
  } else if (r.kind === "donation") {
    const d = r.data as Parameters<typeof donationText>[0];
    await reply(chatId, donationText(d));
    await tell(r.artist_telegram_id, `Донат ${fmt(r.arts)} ₽ (${fmt(r.stars)} ★) от ${esc((d as unknown as { member: { name: string } }).member.name)}!`);
  } else {
    const f = r.data as { title: string; raised: number; goal: number };
    await reply(chatId, `Спасибо за взнос! Сбор «${esc(f.title)}»: ${fmt(f.raised)} из ${fmt(f.goal)} ₽.`);
  }
}

// ---- Telegram Business: /addart в переписке художника с клиентом ----

async function onBusinessConnection(c: { id: string; user: TgUser; can_reply?: boolean; is_enabled: boolean; rights?: { can_reply?: boolean } }) {
  await rpc("save_business_connection", {
    p_id: c.id, p_user_tg: c.user.id, p_can_reply: c.rights?.can_reply ?? c.can_reply ?? false, p_enabled: c.is_enabled,
  });
  if (c.is_enabled) {
    const artist = await artistByTelegramId(c.user.id);
    await tell(c.user.id, artist
      ? "Бизнес-подключение готово. В переписке с клиентом напишите <code>/addart 3000</code>, и АРТы начислятся по его уровню."
      : "Бот подключён к бизнес-аккаунту, но начислять АРТы могут только художники Артоки.");
  }
}

async function onBusinessMessage(m: {
  business_connection_id: string; chat: { id: number; first_name?: string; last_name?: string; username?: string; type: string };
  from?: TgUser; text?: string; message_id: number;
}) {
  if (!m.text || !m.from || m.chat.type !== "private") return;
  const match = m.text.trim().match(/^\/addart(?:@\w+)?\s+([\d\s]+)/i);
  if (!match || m.from.id === m.chat.id) return; // команду пишет художник, а не клиент
  const amount = Number(match[1].replace(/\s/g, ""));
  const say = (text: string) => tg("sendMessage", {
    business_connection_id: m.business_connection_id, chat_id: m.chat.id, text, parse_mode: "HTML",
    reply_parameters: { message_id: m.message_id },
  }).catch(() => {});
  if (!amount || amount > MAX_AMOUNT) return say("Укажите сумму заказа: /addart 3000");
  try {
    const customer = await upsertUser({
      id: m.chat.id, first_name: m.chat.first_name ?? "Клиент", last_name: m.chat.last_name, username: m.chat.username,
    });
    const r = await rpc<OperationResult & { referral?: Referral }>("business_accrual", {
      p_connection: m.business_connection_id, p_sender_tg: m.from.id, p_customer: customer.id, p_amount: amount,
    });
    await say(`<b>+${fmt(r.earn)} АРТ</b> за заказ на ${fmt(amount)} ₽ · ${esc(r.tier.name)} ${Number(r.tier.earn_pct)}%\n` +
      `Баланс «${esc(r.program.name)}»: ${fmt(r.balance_after)} АРТ`);
    if (r.referral) {
      if (r.referral.referrer_bonus > 0) await tell(r.referral.referrer_telegram_id, referralText(r.referral));
    }
  } catch (e) {
    await say(e instanceof AppError ? esc(e.message) : "Не получилось начислить АРТы. Попробуйте через приложение.");
  }
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

async function onCallback(cb: { id: string; from: TgUser; data?: string; inline_message_id?: string; message?: { chat: { id: number }; message_id: number; text?: string } }) {
  const answer = (text: string, alert = true) => tg("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert });

  // Решение админа по заявке художника.
  if (cb.data?.startsWith("ap:")) {
    if (!ADMINS.has(String(cb.from.id))) return answer("Только для админов");
    const [, verdict, id] = cb.data.split(":");
    try {
      const r = await rpc<{ status: string; user: { name: string; telegram_id: number }; program: { name: string } | null }>(
        "decide_application", { p_admin_tg: cb.from.id, p_id: id, p_approve: verdict === "y" });
      const approved = r.status === "approved";
      if (cb.message) {
        await tg("editMessageText", {
          chat_id: cb.message.chat.id, message_id: cb.message.message_id, parse_mode: "HTML",
          text: `${esc(cb.message.text ?? "")}\n\n${approved ? "✅ Принята" : "❌ Отклонена"} (${esc(cb.from.first_name)})`,
        }).catch(() => {});
      }
      await tell(r.user.telegram_id, approved
        ? `Ваша заявка одобрена! Вы художник Артоки в программе «${esc(r.program?.name ?? "")}». Откройте приложение, чтобы настроить уровни.`
        : "Ваша заявка художника пока отклонена. Можно подать новую позже.",
        approved ? { reply_markup: appButton("Открыть кассу") } : {});
      return answer(approved ? "Заявка принята" : "Заявка отклонена", false);
    } catch (e) {
      return answer(e instanceof AppError ? e.message : "Ошибка");
    }
  }

  if (!cb.data || !cb.inline_message_id) return answer("Кнопка устарела");
  const claim = await verifyClaim(WEBHOOK_SECRET, cb.data);
  if (claim === "expired") return answer("Срок кнопки истёк. Попросите художника отправить новую.");
  if (!claim) return answer("Кнопка недействительна");
  if (claim.artistTgId === cb.from.id) return answer("Эту кнопку нажимает клиент, а не художник");

  const artist = await artistByTelegramId(claim.artistTgId);
  if (!artist) return answer("Художник больше не участвует в программе");
  const me = await upsertUser(cb.from);
  try {
    const r = await rpc<OperationResult & { referral?: Referral }>("claim_inline", {
      p_ref: cb.inline_message_id, p_artist: artist.id, p_member: me.id, p_amount: claim.amount,
    });
    await tg("editMessageText", {
      inline_message_id: cb.inline_message_id, parse_mode: "HTML",
      text: `<b>Заказ у @${esc(artist.nick)} на ${fmt(claim.amount)} ₽</b>\n${esc(r.member.name)}: +${fmt(r.earn)} АРТ · ${esc(r.tier.name)} ${Number(r.tier.earn_pct)}%`,
    });
    await answer(`+${fmt(r.earn)} АРТ зачислено в «${r.program.name}». Баланс: ${fmt(r.balance_after)} АРТ`);
    await afterOperation(r);
  } catch (e) {
    if (e instanceof AppError) return answer(e.message);
    throw e;
  }
}

// ---- расписание: подарки на день рождения ----

async function runBirthdays() {
  const list = await rpc<{ telegram_id: number; name: string; program: string; bonus: number; ttl_days: number }[]>("grant_birthday_bonuses");
  for (const b of list) await tell(b.telegram_id, birthdayText(b), { reply_markup: appButton("Открыть кошелёк") });
  return { granted: list.length };
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
    allowed_updates: ["message", "inline_query", "callback_query", "pre_checkout_query", "business_connection", "business_message"],
  });
  await tg("setMyCommands", {
    commands: [
      { command: "bonusp", description: "Вступить в программу художника или группы" },
      { command: "balance", description: "Баланс АРТов" },
      { command: "gift", description: "Активировать подарочный сертификат" },
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
  // Без секретов бот не работает: иначе подпись кнопок была бы предсказуемой.
  if (!BOT_TOKEN || !WEBHOOK_SECRET || WEBHOOK_SECRET.length < 16) {
    const problems = [
      !BOT_TOKEN && "BOT_TOKEN не задан",
      !WEBHOOK_SECRET && "WEBHOOK_SECRET не задан",
      WEBHOOK_SECRET && WEBHOOK_SECRET.length < 16 && `WEBHOOK_SECRET слишком короткий (${WEBHOOK_SECRET.length} симв., нужно от 16)`,
    ].filter(Boolean);
    return new Response(`Бот не настроен: ${problems.join("; ")}.\nДобавьте секреты в Supabase → Edge Functions → Secrets.`, {
      status: 503, headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const url = new URL(req.url);

  // Вызов по расписанию (pg_cron) с секретом из базы.
  if (url.searchParams.get("cron") === "birthday") {
    const ok = await rpc<boolean>("check_cron_secret", { p_secret: req.headers.get("x-cron-secret") ?? "" }).catch(() => false);
    if (!ok) return new Response("forbidden", { status: 403 });
    return Response.json(await runBirthdays());
  }

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
    else if (update.pre_checkout_query) await onPreCheckout(update.pre_checkout_query);
    else if (update.business_connection) await onBusinessConnection(update.business_connection);
    else if (update.business_message) await onBusinessMessage(update.business_message);
  } catch (e) {
    const chatId = update.message?.chat?.id;
    if (e instanceof AppError && chatId) await reply(chatId, esc(e.message)).catch(() => {});
    else console.error("update failed", e);
  }
  // Telegram должен получить 200, иначе будет повторять обновление.
  return new Response("ok");
});
