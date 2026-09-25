// Тексты уведомлений бота. Разметка — Telegram HTML.

const NB = " ";

export function fmt(n: number): string {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
  return (v < 0 ? "−" : "") + s;
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

type Tier = { name: string; earn_pct: number; pay_pct: number };
export type OperationResult = {
  mode: "earn" | "redeem";
  amount: number;
  redeem: number;
  paid: number;
  earn: number;
  points: number;
  balance_after: number;
  tier: Tier;
  new_tier: Tier;
  tier_up: boolean;
  member: { id: string; name: string; code: string; telegram_id: number };
  artist: { id: string; nick: string };
  program: { id: string; name: string; type: "group" | "solo" };
  order?: { id: string; title: string } | null;
};

export function operationText(r: OperationResult): string {
  const lines: string[] = [];
  const nick = "@" + esc(r.artist.nick);
  if (r.mode === "earn") {
    lines.push(`<b>+${fmt(r.earn)} АРТ</b> от ${nick} за заказ на ${fmt(r.amount)} ₽`);
  } else {
    lines.push(`<b>−${fmt(r.redeem)} АРТ</b> списано у ${nick} в счёт заказа на ${fmt(r.amount)} ₽`);
    lines.push(`Доплата ${fmt(r.paid)} ₽, начислено +${fmt(r.earn)} АРТ`);
  }
  if (r.order) lines.push(`Заказ: «${esc(r.order.title)}»`);
  lines.push(`Баланс «${esc(r.program.name)}»: ${fmt(r.balance_after)} АРТ`);
  if (r.tier_up) {
    lines.push("");
    lines.push(`Новый уровень у ${nick}: <b>${esc(r.new_tier.name)}</b>. Теперь копите ${Number(r.new_tier.earn_pct)}% и платите АРТами до ${Number(r.new_tier.pay_pct)}% заказа.`);
  }
  return lines.join("\n");
}

export function cancelText(r: {
  entry: { points: number; created_at: string };
  artist: { nick: string };
  program: { name: string };
  balance_after: number;
}): string {
  const d = new Date(r.entry.created_at);
  const date = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const pts = r.entry.points > 0 ? `+${fmt(r.entry.points)}` : fmt(r.entry.points);
  return `@${esc(r.artist.nick)} отменил(а) операцию от ${date} (${pts} АРТ).\nБаланс «${esc(r.program.name)}»: ${fmt(r.balance_after)} АРТ`;
}

export function joinText(p: { name: string; type: "group" | "solo"; artists: { nick: string }[] }, joined: boolean, balance: number): string {
  const nicks = p.artists.map((a) => "@" + esc(a.nick)).join(", ");
  if (!joined) return `Вы уже в программе «${esc(p.name)}». Баланс: ${fmt(balance)} АРТ`;
  if (p.type === "group") {
    return `Вы в программе коллектива <b>«${esc(p.name)}»</b>.\nХудожники: ${nicks}.\nКошелёк общий: АРТы, полученные у одного, можно тратить у любого из них. Уровень считается отдельно у каждого художника.`;
  }
  return `Вы в программе <b>${esc(p.name)}</b> (${nicks}).\nКошелёк личный: АРТы тратятся только у этого художника.`;
}

export const WELCOME =
  "Это <b>Артоки</b> — бонусная программа художников.\n1 АРТ = 1 ₽\n\n" +
  "Чтобы вступить, откройте ссылку художника или отправьте /bonusp &lt;группа или ник&gt;.";

export const HELP =
  "/bonusp &lt;группа или ник&gt; — вступить в программу\n" +
  "/balance — баланс АРТов\n" +
  "/app — открыть кошелёк\n\n" +
  "Художникам: в переписке с клиентом наберите <code>@бот 3000</code>, чтобы начислить АРТы за заказ на 3 000 ₽.";

export type OrderResult = {
  title: string;
  price: number | null;
  stages: string[];
  stage: number;
  stage_name: string;
  status: "active" | "done" | "cancelled";
  artist: { nick: string };
  event?: "stage" | "done" | "reopened" | null;
};

function stageLine(o: OrderResult): string {
  return o.stages.map((s, i) => (i < o.stage ? `✓ ${esc(s)}` : i === o.stage ? `<b>● ${esc(s)}</b>` : `○ ${esc(s)}`)).join("\n");
}

export function orderCreatedText(o: OrderResult): string {
  const price = o.price ? ` · ${fmt(o.price)} ₽` : "";
  return `@${esc(o.artist.nick)} создал(а) заказ <b>«${esc(o.title)}»</b>${price}\n\n${stageLine(o)}`;
}

export function orderStageText(o: OrderResult): string {
  const head = o.event === "done"
    ? `Заказ <b>«${esc(o.title)}»</b> у @${esc(o.artist.nick)} готов!`
    : `Заказ <b>«${esc(o.title)}»</b> у @${esc(o.artist.nick)}: этап «${esc(o.stage_name)}» (${o.stage + 1} из ${o.stages.length})`;
  return `${head}\n\n${stageLine(o)}`;
}

export function orderCancelText(o: OrderResult): string {
  return `@${esc(o.artist.nick)} отменил(а) заказ «${esc(o.title)}».`;
}

// ---- V1/V2 ----

export function mskTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function slotsOpenedText(nick: string, free: number | null, accessAt: string | null): string {
  const count = free ? ` (${free})` : "";
  const when = accessAt && new Date(accessAt).getTime() > Date.now() + 60_000
    ? `\nДля вашего уровня запись откроется ${mskTime(accessAt)} (МСК).`
    : "\nЗаписаться можно уже сейчас.";
  return `@${esc(nick)} открыл(а) слоты на заказы${count}.${when}`;
}

export function slotRequestText(r: { member: { name: string; code: string }; comment: string; tier: { name: string } }): string {
  return `Новая заявка на слот от <b>${esc(r.member.name)}</b> (${esc(r.member.code)}, уровень «${esc(r.tier.name)}»)` +
    (r.comment ? `:\n«${esc(r.comment)}»` : ".") + "\n\nОтветьте в Mini App → Заказы.";
}

export function slotDecisionText(nick: string, accepted: boolean, title?: string): string {
  return accepted
    ? `@${esc(nick)} принял(а) вашу заявку. Заказ <b>«${esc(title ?? "")}»</b> в очереди.`
    : `@${esc(nick)} пока не может взять вашу заявку. Попробуйте в следующий раз.`;
}

export function referralText(r: { friend_name: string; referrer_bonus: number; program: string }): string {
  return `Ваш друг ${esc(r.friend_name)} сделал(а) первый заказ. <b>+${fmt(r.referrer_bonus)} АРТ</b> в «${esc(r.program)}»!`;
}

export function referralFriendText(r: { friend_bonus: number; program: string }): string {
  return `Бонус за приглашение: <b>+${fmt(r.friend_bonus)} АРТ</b> в «${esc(r.program)}».`;
}

export function birthdayText(r: { name: string; program: string; bonus: number; ttl_days: number }): string {
  return `С днём рождения, ${esc(r.name)}! 🎂\n«${esc(r.program)}» дарит вам <b>${fmt(r.bonus)} АРТ</b>. Они действуют ${r.ttl_days} дн.`;
}

export function donationText(r: { amount: number; points: number; artist: { nick: string }; program: { name: string }; balance_after: number }): string {
  const pts = r.points > 0 ? `\n<b>+${fmt(r.points)} АРТ</b>, баланс «${esc(r.program.name)}»: ${fmt(r.balance_after)} АРТ` : "";
  return `@${esc(r.artist.nick)} благодарит за донат ${fmt(r.amount)} ₽!${pts}`;
}

export function giftText(code: string, amount: number, where: string, link: string): string {
  return `Подарочный сертификат на <b>${fmt(amount)} АРТ</b> (${esc(where)}).\n\nКод: <code>${esc(code)}</code>\nАктивировать: ${link}\n\nПерешлите это сообщение тому, кому дарите.`;
}

export function artAddedText(nick: string, title: string): string {
  return `@${esc(nick)} добавил(а) арт к заказу «${esc(title)}». Смотрите в Mini App → Коллекция.`;
}
