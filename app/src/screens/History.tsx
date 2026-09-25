import { useLoad, type Entry, type Program } from "../api";
import { dmy, ErrorBox, fmt, Loading, pct, signed } from "../ui";

export function EntryRow({ e, withArtist }: { e: Entry; withArtist?: boolean }) {
  const title = e.kind === "redeem" ? `Оплата АРТами · заказ ${fmt(e.order_amount)} ₽` : `Заказ · ${fmt(e.order_amount)} ₽`;
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
  const { data, error, loading, reload } = useLoad<{ program: Program; balance: number; history: Entry[] }>("history", { program_id: programId });
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;
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
    </>
  );
}
