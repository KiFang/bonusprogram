import { useState } from "react";
import { call, useLoad, type Entry } from "../api";
import { useNav } from "../nav";
import { confirmDialog, haptic } from "../tg";
import { dmy, ErrorBox, fmt, hm, Loading, signed } from "../ui";

type Op = Entry & { member: { name: string; code: string }; can_cancel: boolean };

export function Operations() {
  const { toast } = useNav();
  const { data, error, loading, reload } = useLoad<{ paid_total: number; items: Op[] }>("operations");
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;

  async function cancel(op: Op) {
    const ok = await confirmDialog(`Отменить операцию ${signed(op.points)} АРТ для ${op.member.name}?`);
    if (!ok) return;
    setBusy(op.id);
    try {
      await call("cancel", { entry_id: op.id });
      haptic("success");
      toast("Операция отменена, клиент получил уведомление");
      await reload();
    } catch (e) {
      haptic("error");
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const live = data.items.filter((i) => !i.reversed).length;
  return (
    <>
      <div className="row2">
        <div className="stat"><div className="eyebrow">Оплачено деньгами</div><div className="h2">{fmt(data.paid_total)} ₽</div></div>
        <div className="stat"><div className="eyebrow">Операций</div><div className="h2">{live}</div></div>
      </div>
      {data.items.length === 0 ? (
        <div className="sm muted">Операций пока нет. Начислите АРТы в кассе или прямо в чате с клиентом.</div>
      ) : (
        <div className="list">
          {data.items.map((op) => (
            <div className={"li" + (op.reversed ? " cancelled" : "")} key={op.id}>
              <div className="li-main">
                <div className="li-top">
                  <span style={{ fontWeight: 500 }}>{op.member.name} <span className="mono muted sm">{op.member.code}</span></span>
                  <span className={"pts " + (op.points >= 0 ? "plus" : "minus")}>{signed(op.points)}</span>
                </div>
                <div className="li-top">
                  <span className="mono muted xs">
                    {dmy(op.created_at)} {hm(op.created_at)} · {op.kind === "redeem" ? `списано ${fmt(op.redeemed)} из ${fmt(op.order_amount)} ₽` : `заказ ${fmt(op.order_amount)} ₽`}
                    {op.source === "inline" && " · из чата"}
                    {op.reversed && " · отменено"}
                  </span>
                  {op.can_cancel && (
                    <button className="btn btn-sm" disabled={busy === op.id} onClick={() => cancel(op)}>Отменить</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
