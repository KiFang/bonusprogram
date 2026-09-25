import { useState } from "react";
import { useLoad, type Order } from "../api";
import { useNav } from "../nav";
import { Avatar, dmy, ErrorBox, fmt, Loading, Section } from "../ui";

const STATUS_LABEL: Record<Order["status"], string> = { active: "В работе", done: "Готов", cancelled: "Отменён" };

export function OrderRow({ o, forArtist }: { o: Order; forArtist?: boolean }) {
  const { push } = useNav();
  return (
    <button className={"li" + (o.status === "cancelled" ? " cancelled" : "")} onClick={() => push({ name: "order", id: o.id })}>
      {forArtist ? (
        <div className="avatar" style={{ width: 36, height: 36, background: "var(--line2)", color: "var(--text)" }}>{o.member.name.slice(0, 1)}</div>
      ) : (
        <Avatar artist={o.artist} />
      )}
      <div className="li-main">
        <div className="li-top">
          <span style={{ fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.title}</span>
          <span className={"status-chip " + o.status}>{o.status === "active" ? o.stage_name : STATUS_LABEL[o.status]}</span>
        </div>
        <div className="stagebar" aria-hidden="true">
          {o.stages.map((_, i) => <span key={i} className={i < o.stage || o.status === "done" ? "on" : i === o.stage ? "cur" : ""} />)}
        </div>
        <div className="mono muted xs">
          {forArtist ? `${o.member.name} · ${o.member.code}` : `@${o.artist.nick}`}
          {o.price ? ` · ${fmt(o.price)} ₽` : ""} · {dmy(o.updated_at)}
        </div>
      </div>
    </button>
  );
}

function split(list: Order[]) {
  return { active: list.filter((o) => o.status === "active"), rest: list.filter((o) => o.status !== "active") };
}

/** Заказы художника. */
export function ArtistOrders() {
  const { push } = useNav();
  const { data, error, loading, reload } = useLoad<Order[]>("orders");
  const [showDone, setShowDone] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;
  const { active, rest } = split(data);
  return (
    <>
      <button className="btn btn-primary" onClick={() => push({ name: "neworder" })}>+ Новый заказ</button>
      <Section title="В работе" aside={String(active.length)}>
        {active.length ? (
          <div className="list">{active.map((o) => <OrderRow key={o.id} o={o} forArtist />)}</div>
        ) : (
          <div className="sm muted">Активных заказов нет. Создайте заказ, и клиент будет видеть, на каком он этапе.</div>
        )}
      </Section>
      {rest.length > 0 && (
        <Section title="Готовые и отменённые" aside={<button className="linkbtn" onClick={() => setShowDone(!showDone)}>{showDone ? "Скрыть" : `Показать (${rest.length})`}</button>}>
          {showDone && <div className="list">{rest.map((o) => <OrderRow key={o.id} o={o} forArtist />)}</div>}
        </Section>
      )}
    </>
  );
}

/** Заказы клиента у всех художников. */
export function MyOrders() {
  const { data, error, loading, reload } = useLoad<Order[]>("my_orders");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;
  const { active, rest } = split(data);
  if (!data.length) {
    return (
      <div className="empty">
        <div className="h2" style={{ fontSize: 16 }}>Заказов пока нет</div>
        <div className="soft">Когда художник заведёт на вас заказ, здесь появится его статус: очередь, скетч, покраска, готово. Уведомления о каждом этапе придут в бот.</div>
      </div>
    );
  }
  return (
    <>
      {active.length > 0 && (
        <Section title="В работе" aside={String(active.length)}>
          <div className="list">{active.map((o) => <OrderRow key={o.id} o={o} />)}</div>
        </Section>
      )}
      {rest.length > 0 && (
        <Section title="Готовые">
          <div className="list">{rest.map((o) => <OrderRow key={o.id} o={o} />)}</div>
        </Section>
      )}
    </>
  );
}
