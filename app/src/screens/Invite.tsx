import { useState } from "react";
import { call } from "../api";
import { useNav } from "../nav";
import { haptic } from "../tg";
import { ErrorBox } from "../ui";

export function Invite({ code }: { code: string }) {
  const { me, reset, reloadMe, toast } = useNav();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me.artist) {
    return (
      <div className="empty">
        <div className="h2" style={{ fontSize: 16 }}>Вы уже художник Артоки</div>
        <button className="btn btn-primary" onClick={() => reset({ name: "cassa" })}>Открыть кассу</button>
      </div>
    );
  }

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await call("accept_invite", { code });
      haptic("success");
      await reloadMe();
      toast("Добро пожаловать в Артоки!");
      reset({ name: "more" });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="empty">
        <div className="h2">Приглашение художника</div>
        <div className="soft" style={{ lineHeight: 1.55 }}>
          Вас пригласили в бонусную программу Артоки. Вы сможете начислять клиентам АРТы за заказы, настроить свои уровни лояльности и видеть постоянных клиентов.
        </div>
        <div className="sm muted">
          Ваш ник в программе: <span className="mono gold">@{(me.user.username ?? "").toLowerCase() || "не задан"}</span>
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="cta">
        <button className="btn btn-primary" disabled={busy} onClick={accept}>{busy ? "Подключаем…" : "Стать художником Артоки"}</button>
      </div>
    </>
  );
}
