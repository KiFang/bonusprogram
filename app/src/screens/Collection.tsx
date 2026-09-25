import { useState } from "react";
import { call, useLoad, type GalleryItem } from "../api";
import { useNav } from "../nav";
import { Avatar, dmy, ErrorBox, Loading } from "../ui";

export function Lightbox({ item, onClose, actions }: { item: GalleryItem; onClose: () => void; actions?: React.ReactNode }) {
  return (
    <div className="lightbox" role="dialog" aria-label="Просмотр арта" onClick={onClose}>
      {item.url ? <img src={item.url} alt={item.order_title ?? "Арт"} /> : <div className="muted">Картинка недоступна</div>}
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <div className="sm">
          @{item.artist.nick}{item.order_title ? ` · ${item.order_title}` : ""} · {dmy(item.created_at)}
        </div>
        <div className="row2">
          {actions}
          <button className="btn btn-sm" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

export function Thumb({ item, onOpen }: { item: GalleryItem; onOpen: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const blurred = item.nsfw && !revealed;
  return (
    <button className={"thumb" + (item.hidden ? " is-hidden" : "")} onClick={() => (blurred ? setRevealed(true) : onOpen())}
      aria-label={blurred ? "Показать арт 18+" : "Открыть арт"}>
      {item.url ? <img src={item.url} alt="" loading="lazy" style={blurred ? { filter: "blur(18px)" } : undefined} /> : null}
      {blurred && <span className="thumb-badge">18+ · нажмите</span>}
      {item.hidden && <span className="thumb-badge">скрыт</span>}
    </button>
  );
}

/** Коллекция артов клиента, по художникам. */
export function Collection() {
  const { toast } = useNav();
  const { data, error, loading, reload, setData } = useLoad<GalleryItem[]>("gallery");
  const [open, setOpen] = useState<GalleryItem | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;

  if (!data.length) {
    return (
      <div className="empty">
        <div className="h2" style={{ fontSize: 16 }}>Коллекция пока пуста</div>
        <div className="soft">Когда художник приложит готовый арт к вашему заказу, он появится здесь. Картинки видите только вы.</div>
      </div>
    );
  }

  const visible = data.filter((g) => showHidden || !g.hidden);
  const hiddenCount = data.filter((g) => g.hidden).length;
  const groups = new Map<string, GalleryItem[]>();
  visible.forEach((g) => groups.set(g.artist.id, [...(groups.get(g.artist.id) ?? []), g]));

  async function toggleHidden(item: GalleryItem) {
    try {
      await call("gallery_hide", { item_id: item.id, hidden: !item.hidden });
      setData(data!.map((g) => (g.id === item.id ? { ...g, hidden: !g.hidden } : g)));
      toast(item.hidden ? "Арт снова в коллекции" : "Арт скрыт");
      setOpen(null);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <div className="sec-head">
        <div className="h2">Моя коллекция</div>
        {hiddenCount > 0 && (
          <button className="linkbtn sm" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? "Не показывать скрытые" : `Скрытые (${hiddenCount})`}
          </button>
        )}
      </div>
      {[...groups.values()].map((items) => (
        <section className="sec" key={items[0].artist.id}>
          <div className="sec-head" style={{ alignItems: "center" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Avatar artist={items[0].artist} size={28} />
              <span style={{ fontWeight: 500 }}>@{items[0].artist.nick}</span>
            </div>
            <span className="sm muted">{items.length}</span>
          </div>
          <div className="gallery-grid">
            {items.map((g) => <Thumb key={g.id} item={g} onOpen={() => setOpen(g)} />)}
          </div>
        </section>
      ))}
      {open && (
        <Lightbox item={open} onClose={() => setOpen(null)}
          actions={<button className="btn btn-sm" onClick={() => toggleHidden(open)}>{open.hidden ? "Вернуть" : "Скрыть"}</button>} />
      )}
    </>
  );
}
