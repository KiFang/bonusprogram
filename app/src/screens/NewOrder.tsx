import { useEffect, useState } from "react";
import { call, useLoad, type Order } from "../api";
import { useNav } from "../nav";
import { haptic } from "../tg";
import { digits, ErrorBox, fmt, Icon } from "../ui";

export function NewOrder({ code: initialCode }: { code?: string }) {
  const { push, pop, toast } = useNav();
  const settings = useLoad<{ artist: { order_stages: string[] } }>("settings");
  const [code, setCode] = useState(initialCode ?? "");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState(0);
  const [stages, setStages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data && !stages.length) setStages(settings.data.artist.order_stages);
  }, [settings.data, stages.length]);

  const validCode = /^KF-[2-9A-Z]{4}$/.test(code);
  const canSave = validCode && title.trim().length > 0 && stages.length >= 2 && stages.every((s) => s.trim()) && !busy;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const o = await call<Order>("create_order", { code, title: title.trim(), price: price || null, stages: stages.map((s) => s.trim()) });
      haptic("success");
      toast("Заказ создан, клиент получил уведомление");
      pop();
      push({ name: "order", id: o.id });
    } catch (e) {
      haptic("error");
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="h2">Новый заказ</div>
      <div className="field">
        <label htmlFor="o-code">Код клиента</label>
        <input id="o-code" className="input mono" value={code} placeholder="KF-0000" autoComplete="off" spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase().trim())} />
      </div>
      <div className="field">
        <label htmlFor="o-title">Что рисуем</label>
        <input id="o-title" className="input" maxLength={80} value={title} placeholder="Портрет в полный рост" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="o-price">Цена, ₽ (необязательно)</label>
        <input id="o-price" className="input mono" inputMode="numeric" value={price ? fmt(price) : ""} placeholder="0"
          onChange={(e) => setPrice(Math.min(digits(e.target.value), 10_000_000))} />
      </div>

      <div className="field">
        <label>Этапы</label>
        {settings.error && <ErrorBox message={settings.error} onRetry={settings.reload} />}
        <div className="stage-edit">
          {stages.map((s, i) => (
            <div className="row-input" key={i}>
              <span className="mono muted sm" style={{ width: 18, alignSelf: "center" }}>{i + 1}</span>
              <input className="input" maxLength={32} value={s} aria-label={`Этап ${i + 1}`}
                onChange={(e) => setStages(stages.map((x, k) => (k === i ? e.target.value : x)))} />
              {stages.length > 2 && (
                <button className="icon-btn" aria-label={`Удалить этап ${i + 1}`} onClick={() => setStages(stages.filter((_, k) => k !== i))}>{Icon.trash}</button>
              )}
            </div>
          ))}
          {stages.length < 8 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setStages([...stages.slice(0, -1), "Новый этап", stages[stages.length - 1] ?? "Готово"])}>
              + Этап
            </button>
          )}
        </div>
        <div className="sm muted">Последний этап означает «готово». Шаблон этапов меняется во вкладке «Уровни».</div>
      </div>

      {error && <ErrorBox message={error} />}
      <div className="cta">
        <button className="btn btn-primary" disabled={!canSave} onClick={save}>{busy ? "Создаём…" : "Создать заказ"}</button>
      </div>
    </>
  );
}
