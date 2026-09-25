import { useState } from "react";
import { call, uploadArt, useLoad, type GalleryItem, type OrderDetail as Detail } from "../api";
import { prepareImage } from "../image";
import { Lightbox, Thumb } from "./Collection";
import { useNav } from "../nav";
import { confirmDialog, haptic } from "../tg";
import { Avatar, dmy, ErrorBox, fmt, hm, Loading, Section } from "../ui";
import { EntryRow } from "./History";

const EVENT_LABEL: Record<string, string> = {
  created: "Заказ создан", stage: "Этап", done: "Готово", reopened: "Возвращён в работу", cancelled: "Заказ отменён",
};

export function OrderDetail({ id }: { id: string }) {
  const { push, pop, toast } = useNav();
  const { data: o, error, loading, reload, setData } = useLoad<Detail>("order", { order_id: id });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [nsfw, setNsfw] = useState(false);
  const [open, setOpen] = useState<GalleryItem | null>(null);

  if (loading && !o) return <Loading />;
  if (error || !o) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;

  const last = o.stages.length - 1;
  const cancelled = o.status === "cancelled";

  async function setStage(stage: number) {
    setBusy(true);
    try {
      const r = await call<Detail>("set_stage", { order_id: id, stage });
      haptic("success");
      setData({ ...o!, ...r });
      toast(r.status === "done" ? "Заказ готов, клиент получил уведомление" : `Этап «${r.stage_name}», клиент получил уведомление`);
      reload();
    } catch (e) {
      haptic("error");
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 10);
    setUploading(list.length);
    let added: GalleryItem[] = [];
    for (const f of list) {
      try {
        added = [...added, await uploadArt(id, await prepareImage(f), nsfw)];
      } catch (e) {
        toast((e as Error).message);
      }
      setUploading((n) => n - 1);
    }
    if (added.length) {
      haptic("success");
      toast(added.length === 1 ? "Арт добавлен, клиент получил уведомление" : `Добавлено артов: ${added.length}`);
      setData({ ...o!, gallery: [...o!.gallery, ...added] });
    }
  }

  async function removeArt(item: GalleryItem) {
    if (!(await confirmDialog("Удалить картинку из коллекции клиента?"))) return;
    try {
      await call("delete_art", { item_id: item.id });
      setData({ ...o!, gallery: o!.gallery.filter((g) => g.id !== item.id) });
      setOpen(null);
      toast("Картинка удалена");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function cancel() {
    if (!(await confirmDialog(`Отменить заказ «${o!.title}»? Клиент получит уведомление.`))) return;
    setBusy(true);
    try {
      await call("cancel_order", { order_id: id });
      haptic("success");
      toast("Заказ отменён");
      pop();
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hero">
        {o.is_artist ? (
          <div className="avatar" style={{ width: 48, height: 48, background: "var(--line2)", color: "var(--text)" }}>{o.member.name.slice(0, 1)}</div>
        ) : (
          <Avatar artist={o.artist} size={48} />
        )}
        <div className="stack-col">
          <div className="h2" style={{ fontSize: 18 }}>{o.title}</div>
          <div className="sm muted">
            {o.is_artist ? `${o.member.name} · ${o.member.code}` : `@${o.artist.nick}`}
            {o.price ? ` · ${fmt(o.price)} ₽` : ""}
          </div>
        </div>
      </div>

      {cancelled && <div className="notice bad">Заказ отменён.</div>}
      {o.status === "done" && <div className="notice ok">Заказ готов{o.done_at ? ` · ${dmy(o.done_at)}` : ""}.</div>}

      <Section title="Этапы" aside={`${Math.min(o.stage + 1, o.stages.length)} из ${o.stages.length}`}>
        <ol className="stepper">
          {o.stages.map((s, i) => {
            const state = o.status === "done" || i < o.stage ? "done" : i === o.stage ? "cur" : "next";
            return (
              <li key={i} className={state}>
                <span className="dot" />
                <span className="name">{s}</span>
                {o.is_artist && !cancelled && i !== o.stage && (
                  <button className="linkbtn sm" disabled={busy} onClick={() => setStage(i)}>сюда</button>
                )}
              </li>
            );
          })}
        </ol>
      </Section>

      {(o.price || o.paid > 0) && (
        <div className="summary">
          {o.price ? <div className="kv"><span className="muted">Цена</span><span>{fmt(o.price)} ₽</span></div> : null}
          <div className="kv"><span className="muted">Оплачено деньгами</span><span>{fmt(o.paid)} ₽</span></div>
          {o.redeemed > 0 && <div className="kv"><span className="muted">Оплачено АРТами</span><span>{fmt(o.redeemed)} АРТ</span></div>}
          {o.price ? <div className="kv"><span className="muted">Осталось</span><span>{fmt(Math.max(0, o.price - o.paid - o.redeemed))} ₽</span></div> : null}
        </div>
      )}

      {(o.gallery.length > 0 || o.is_artist) && (
        <Section title="Арты" aside={o.gallery.length ? String(o.gallery.length) : undefined}>
          {o.gallery.length > 0 && (
            <div className="gallery-grid">{o.gallery.map((g) => <Thumb key={g.id} item={g} onOpen={() => setOpen(g)} />)}</div>
          )}
          {o.is_artist && !cancelled && (
            <>
              <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
                {uploading ? `Загружаем… (${uploading})` : "+ Приложить арт"}
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={uploading > 0}
                  onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
              </label>
              <label className="sm muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} /> Пометить 18+ (картинка будет размыта)
              </label>
            </>
          )}
        </Section>
      )}

      {o.payments.length > 0 && (
        <Section title="Оплаты">
          <div className="list">{o.payments.map((e) => <EntryRow key={e.id} e={e} />)}</div>
        </Section>
      )}

      <Section title="История">
        <div className="list">
          {o.events.map((ev, i) => (
            <div className="li" key={i}>
              <div className="li-main">
                <div>{EVENT_LABEL[ev.kind] ?? ev.kind}{ev.kind === "stage" || ev.kind === "reopened" ? ` «${ev.stage_name}»` : ""}</div>
                <div className="mono muted xs">{dmy(ev.created_at)} {hm(ev.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {open && (
        <Lightbox item={open} onClose={() => setOpen(null)}
          actions={o.is_artist ? <button className="btn btn-sm" onClick={() => removeArt(open)}>Удалить</button> : undefined} />
      )}

      {o.is_artist && !cancelled && (
        <>
          <button className="btn" onClick={() => push({ name: "cassa", code: o.member.code, orderId: o.id })}>Принять оплату по заказу</button>
          <button className="btn btn-ghost" disabled={busy} onClick={cancel}>Отменить заказ</button>
          <div className="cta">
            {o.stage < last ? (
              <button className="btn btn-primary" disabled={busy} onClick={() => setStage(o.stage + 1)}>
                {o.stage + 1 === last ? "Заказ готов" : `Дальше: «${o.stages[o.stage + 1]}»`}
              </button>
            ) : (
              <button className="btn" disabled={busy} onClick={() => setStage(last - 1)}>Вернуть в работу</button>
            )}
          </div>
        </>
      )}
    </>
  );
}
