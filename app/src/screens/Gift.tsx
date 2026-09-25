import { useState } from "react";
import { call, useLoad, type Certificate } from "../api";
import { useNav } from "../nav";
import { haptic } from "../tg";
import { dmy, ErrorBox, fmt, Loading } from "../ui";

export function Gift({ code }: { code: string }) {
  const { reset, reloadMe, toast } = useNav();
  const { data: c, error, loading } = useLoad<Certificate>("certificate_info", { code });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (loading && !c) return <Loading />;
  if (error || !c) return <ErrorBox message={error ?? "Сертификат не найден"} />;

  const where = c.scope === "group" ? `группы «${c.program.name}»` : `художника @${c.artist?.nick}`;
  const usable = c.status === "issued" && new Date(c.expires_at) > new Date();

  async function activate() {
    setBusy(true);
    setErr(null);
    try {
      await call("activate_certificate", { code });
      haptic("success");
      await reloadMe();
      toast(`+${fmt(c!.amount)} АРТ зачислено`);
      reset({ name: "wallet" });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="wcard">
        <div className="hatch" />
        <div className="eyebrow">Подарочный сертификат</div>
        <div className="balance"><div className="num">{fmt(c.amount)}</div><div className="cur">АРТ</div></div>
        <div className="soft">Сертификат {where}.{c.note ? ` «${c.note}»` : ""}</div>
        <div className="mono sm muted">{c.code} · до {dmy(c.expires_at)}</div>
      </div>
      <div className="soft" style={{ lineHeight: 1.55 }}>
        АРТами сертификата можно оплатить заказ целиком — лимит уровня на них не действует, а сумма засчитывается в ваш уровень.
        {c.scope === "artist" && c.program.type === "group" && " У других художников группы они считаются АРТами этого художника."}
      </div>
      {c.status === "activated" && <div className="notice ok">Сертификат уже активирован{c.activated_by ? ` (${c.activated_by})` : ""}.</div>}
      {c.status === "void" && <div className="notice bad">Сертификат аннулирован.</div>}
      {c.status === "issued" && !usable && <div className="notice bad">Срок сертификата истёк.</div>}
      {err && <ErrorBox message={err} />}
      {usable && (
        <div className="cta">
          <button className="btn btn-primary" disabled={busy} onClick={activate}>{busy ? "Активируем…" : "Активировать"}</button>
        </div>
      )}
    </>
  );
}
