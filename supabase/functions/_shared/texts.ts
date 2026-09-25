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
  "Это <b>Артоки</b> — бонусная программа художников.\n1 АРТ = 1 ₽ = 0,5 ★\n\n" +
  "Чтобы вступить, откройте ссылку художника или отправьте /bonusp &lt;группа или ник&gt;.";

export const HELP =
  "/bonusp &lt;группа или ник&gt; — вступить в программу\n" +
  "/balance — баланс АРТов\n" +
  "/app — открыть кошелёк\n\n" +
  "Художникам: в переписке с клиентом наберите <code>@бот 3000</code>, чтобы начислить АРТы за заказ на 3 000 ₽.";
