import { useState } from "react";
import { call } from "./api";
import { useNav } from "./nav";
import { haptic, openInvoice } from "./tg";
import { digits, fmt } from "./ui";

type Props = {
  kind: "certificate" | "donation" | "fundraiser";
  targetId: string;
  scope?: "artist" | "group";
  label: string;
  presets: number[];
  min: number;
  onPaid?: () => void;
};

/** Оплата звёздами: выбор суммы в АРТ (1 АРТ = 0,5 ★) → счёт Telegram. */
export function StarsPay({ kind, targetId, scope, label, presets, min, onPaid }: Props) {
  const { toast } = useNav();
  const [arts, setArts] = useState(presets[0] ?? min);
  const [busy, setBusy] = useState(false);

  async function pay() {
    if (arts < min) return toast(`Минимум ${fmt(min)} АРТ`);
    setBusy(true);
    try {
      const { link } = await call<{ link: string; stars: number }>("stars_invoice", { kind, target_id: targetId, scope, arts });
      const status = await openInvoice(link);
      if (status === "paid") {
        haptic("success");
        toast(kind === "certificate" ? "Оплачено! Сертификат пришёл в бот" : "Спасибо! Оплата прошла");
        onPaid?.();
      } else if (status === "failed") {
        toast("Оплата не прошла. Обновите Telegram или попробуйте позже.");
      }
    } catch (e) {
      haptic("error");
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <div className="presets">
        {presets.map((v) => (
          <button key={v} className={arts === v ? "on" : ""} aria-pressed={arts === v} onClick={() => setArts(v)}>{fmt(v)}</button>
        ))}
      </div>
      <div className="row-input">
        <input className="input mono" inputMode="numeric" aria-label="Сумма в АРТ" value={arts ? fmt(arts) : ""}
          onChange={(e) => setArts(Math.min(digits(e.target.value), 1_000_000))} />
        <button className="btn btn-primary" style={{ flexShrink: 0 }} disabled={busy} onClick={pay}>
          {busy ? "…" : `${label} · ${fmt(Math.ceil(arts / 2))} ★`}
        </button>
      </div>
      <div className="sm muted">{fmt(arts)} АРТ = {fmt(arts)} ₽ = {fmt(Math.ceil(arts / 2))} ★. Оплата звёздами Telegram.</div>
    </div>
  );
}
