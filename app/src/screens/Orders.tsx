import { useState } from "react";
import { call, useLoad, type Order, type TierInfo } from "../api";
import { confirmDialog, haptic } from "../tg";
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

type SlotRequest = { id: string; comment: string; created_at: string; member: { name: string; code: string }; tier: TierInfo };

function SlotRequests({ onDecided }: { onDecided: () => void }) {
  const { toast, push } = useNav();
  const { data, reload } = useLoad<SlotRequest[]>("slot_requests");
  const [busy, setBusy] = useState<string | null>(null);
  if (!data?.length) return null;

  async function decide(r: SlotRequest, accept: boolean) {
    if (!accept && !(await confirmDialog(`Отклонить заявку ${r.member.name}?`))) return;
    setBusy(r.id);
    try {
      const res = await call<{ order: Order | null }>("decide_slot", { request_id: r.id, accept });
      haptic("success");
      toast(accept ? "Заявка принята, заказ создан" : "Заявка отклонена");
      reload();
      onDecided();
      if (res.order) push({ name: "order", id: res.order.id });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Заявки на слоты" aside={String(data.length)}>
      <div className="list">
        {data.map((r) => (
          <div className="li" key={r.id} style={{ alignItems: "flex-start" }}>
            <div className="li-main">
              <div className="li-top"><span style={{ fontWeight: 500 }}>{r.member.name} <span className="mono muted sm">{r.member.code}</span></span><span className="sm muted">{r.tier.name}</span></div>
              {r.comment && <div className="soft sm">«{r.comment}»</div>}
              <div className="row2">
                <button className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => decide(r, true)}>Принять</button>
                <button className="btn btn-sm" disabled={busy === r.id} onClick={() => decide(r, false)}>Отклонить</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
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
      <SlotRequests onDecided={reload} />
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
