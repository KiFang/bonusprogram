import { useState } from "react";
import { call, useLoad, type Entry, type Program } from "../api";
import { useNav } from "../nav";
import { confirmDialog, haptic } from "../tg";
import { dmy, ErrorBox, fmt, Loading, pct, signed } from "../ui";

const ENTRY_TITLE: Record<string, (e: Entry) => string> = {
  redeem: (e) => `Оплата АРТами · заказ ${fmt(e.order_amount)} ₽`,
  accrual: (e) => `Заказ · ${fmt(e.order_amount)} ₽`,
  donation: (e) => `Донат · ${fmt(e.order_amount)} ₽`,
  gift: () => "Подарочный сертификат",
  referral: () => "Бонус «Приведи друга»",
  birthday: () => "Подарок на день рождения",
  forfeit: () => "АРТы сгорели при выходе",
  bonus: () => "Бонус",
};

export function EntryRow({ e, withArtist }: { e: Entry; withArtist?: boolean }) {
  const title = ENTRY_TITLE[e.kind]?.(e) ?? `Заказ · ${fmt(e.order_amount)} ₽`;
  const meta = [
    dmy(e.created_at),
    withArtist && e.artist_nick ? `@${e.artist_nick}` : null,
    e.kind === "redeem" ? `−${fmt(e.redeemed)} / +${fmt(e.earned)}` : e.tier ? `${e.tier.name} ${pct(e.tier.earn_pct)}%` : null,
    e.source === "inline" ? "из чата" : null,
    e.reversed ? "отменено" : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className={"li" + (e.reversed ? " cancelled" : "")}>
      <div className="li-main">
        <div>{title}</div>
        <div className="mono muted xs">{meta}</div>
      </div>
      <div className={"pts " + (e.points >= 0 ? "plus" : "minus")}>{signed(e.points)}</div>
    </div>
  );
}

export function History({ programId }: { programId: string }) {
  const { reset, reloadMe, toast } = useNav();
  const { data, error, loading, reload } = useLoad<{ program: Program; balance: number; history: Entry[] }>("history", { program_id: programId });
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;

  // Два подтверждения: выход сжигает АРТы программы.
  async function leave() {
    const name = data!.program.name;
    if (!(await confirmDialog(`Выйти из программы «${name}»?`))) return;
    const loss = data!.balance > 0 ? `Ваши ${fmt(data!.balance)} АРТ сгорят и не вернутся, даже если вы вступите снова.` : "История заказов сохранится.";
    if (!(await confirmDialog(`Точно выйти? ${loss}`))) return;
    setBusy(true);
    try {
      await call("leave", { program_id: programId });
      haptic("success");
      await reloadMe();
      toast(`Вы вышли из «${name}»`);
      reset({ name: "wallet" });
    } catch (e) {
      haptic("error");
      toast((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <div className="eyebrow">Кошелёк</div>
        <div className="h2" style={{ fontSize: 18, marginTop: 4 }}>{data.program.name} · {fmt(data.balance)} АРТ</div>
      </div>
      {data.history.length ? (
        <div className="list">{data.history.map((e) => <EntryRow key={e.id} e={e} withArtist />)}</div>
      ) : (
        <div className="sm muted">Операций пока нет.</div>
      )}
      <button className="btn btn-ghost" disabled={busy} onClick={leave}>Выйти из программы</button>
    </>
  );
}
