import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useNav } from "../nav";
import { copyText, Icon } from "../ui";

/** Текст QR-кода. Касса понимает и его, и просто код. */
export const qrPayload = (code: string) => `artoki:${code}`;

export function MyCode() {
  const { me, toast } = useNav();
  const [svg, setSvg] = useState("");

  useEffect(() => {
    QRCode.toString(qrPayload(me.user.code), { type: "svg", margin: 1, color: { dark: "#0B0A0D", light: "#EDEAE4" }, errorCorrectionLevel: "M" })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [me.user.code]);

  return (
    <>
      <div className="center-col">
        <div className="h2">Покажите художнику</div>
        <div className="soft" style={{ maxWidth: 290 }}>Художник сканирует код и вводит сумму заказа. АРТы придут сразу, уведомление — в бот.</div>
      </div>
      <div className="qrwrap" role="img" aria-label={`QR-код участника ${me.user.code}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="center-col">
        <div className="eyebrow">или продиктуйте код</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="bigcode" style={{ userSelect: "all" }}>{me.user.code}</div>
          <button
            className="btn icon"
            aria-label="Скопировать код"
            onClick={async () => toast((await copyText(me.user.code)) ? "Код скопирован" : "Выделите код и скопируйте вручную")}
          >
            {Icon.copy}
          </button>
        </div>
      </div>
      {me.programs.length > 0 && (
        <div className="sm muted" style={{ textAlign: "center" }}>
          Один код для всех ваших программ: {me.programs.map((p) => `«${p.name}»`).join(", ")}
        </div>
      )}
    </>
  );
}
