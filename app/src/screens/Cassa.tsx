import { useEffect, useRef, useState } from "react";
import { call, type Quote } from "../api";
import { useNav } from "../nav";
import { canScanQr, haptic, scanQr } from "../tg";
import { digits, ErrorBox, fmt, Icon, pct, signed, TierChip } from "../ui";

const PRESETS = [1500, 3000, 5000, 10000];

function parseCode(raw: string): string {
  const m = raw.toUpperCase().match(/KF-[2-9A-Z]{4}/);
  return m ? m[0] : raw.trim().toUpperCase();
}

export function Cassa({ initialCode, initialOrderId }: { initialCode?: string; initialOrderId?: string }) {
  const { me, toast } = useNav();
  const [code, setCode] = useState(initialCode ?? "");
  const [mode, setMode] = useState<"earn" | "redeem" | "donate">("earn");
  const [amount, setAmount] = useState(0);
  const [redeem, setRedeem] = useState<number | null>(null);
  const [orderId, setOrderId] = useState<string | null>(initialOrderId ?? null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Quote | null>(null);
  const seq = useRef(0);

  const validCode = /^KF-[2-9A-Z]{4}$/.test(code);

  useEffect(() => {
    setDone(null);
    if (!validCode) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const n = ++seq.current;
    const t = window.setTimeout(async () => {
      try {
        const q = await call<Quote>("quote", { code, mode: mode === "donate" ? "earn" : mode, amount: amount || 1, redeem, order_id: orderId });
        if (n === seq.current) {
          setQuote(q);
          setQuoteError(null);
        }
      } catch (e) {
        if (n === seq.current) {
          setQuote(null);
          setQuoteError((e as Error).message);
        }
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [code, mode, amount, redeem, orderId, validCode]);

  async function scan() {
    const text = await scanQr("Наведите камеру на код участника");
    if (text) {
      setCode(parseCode(text));
      setOrderId(null);
    }
  }

  async function commit() {
    if (!quote || amount <= 0) return;
    setBusy(true);
    try {
      if (mode === "donate") {
        const d = await call<{ points: number }>("donation", { code, amount });
        haptic("success");
        setDone({ ...quote, points: d.points });
        toast(`Донат отмечен${d.points ? ` · +${fmt(d.points)} АРТ` : ""}`);
        return;
      }
      const r = await call<Quote>("commit", { code, mode, amount, redeem, order_id: orderId });
      haptic("success");
      setDone(r);
      toast(`${signed(r.points)} АРТ · ${r.member.name}`);
    } catch (e) {
      haptic("error");
      setQuoteError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDone(null);
    setAmount(0);
    setRedeem(null);
    setQuote(null);
    setCode("");
    setOrderId(null);
  }

  const q = amount > 0 ? quote : null;
  const overLimit = mode === "redeem" && q && redeem !== null && redeem > q.max_redeem;
  const canCommit = !!q && !busy && !overLimit && (mode !== "redeem" || q.redeem > 0);
  const label =
    !validCode ? "Введите код участника"
      : amount <= 0 ? "Введите сумму"
      : !q ? "Считаем…"
      : mode === "donate" ? `Отметить донат ${fmt(amount)} ₽`
      : mode === "earn" ? `Начислить ${fmt(q.earn)} АРТ`
      : q.redeem > 0 ? `Списать ${fmt(q.redeem)} АРТ` : "Нечего списать";

  return (
    <>
      <div className="field">
        <label htmlFor="f-code">Код участника</label>
        <div className="row-input">
          <input
            id="f-code"
            className="input mono"
            value={code}
            placeholder="KF-0000"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setCode(parseCode(e.target.value));
              setOrderId(null);
            }}
          />
          {canScanQr() && (
            <button className="btn icon" onClick={scan} aria-label="Сканировать QR-код">{Icon.scan}</button>
          )}
        </div>
      </div>

      {quote && validCode && (
        <div className="client">
          <div className="avatar" style={{ width: 40, height: 40, background: "var(--line2)", color: "var(--text)" }}>{quote.member.name.slice(0, 1)}</div>
          <div className="li-main">
            <div><b>{quote.member.name}</b> <span className="mono sm muted">{quote.member.code}</span></div>
            <div className="sm muted">
              {quote.program.type === "group" ? `Кошелёк «${quote.program.name}»` : "Личный кошелёк"} · <span className="text">{fmt(quote.balance_before)} АРТ</span>
            </div>
          </div>
          <TierChip name={quote.tier.name} index={quote.tier.index} />
        </div>
      )}
      {quoteError && validCode && <ErrorBox message={quoteError} />}

      {quote && validCode && mode !== "donate" && (quote.orders?.length ?? 0) > 0 && (
        <div className="field">
          <label>Оплата по заказу</label>
          <div className="presets">
            <button aria-pressed={!orderId} className={!orderId ? "on" : ""} onClick={() => setOrderId(null)}>Без заказа</button>
            {quote.orders!.map((o) => (
              <button key={o.id} aria-pressed={orderId === o.id} className={orderId === o.id ? "on" : ""} onClick={() => setOrderId(o.id)}>
                {o.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="seg seg3" role="group" aria-label="Тип операции">
        <button aria-pressed={mode === "earn"} onClick={() => { setMode("earn"); setRedeem(null); }}>Начислить</button>
        <button aria-pressed={mode === "redeem"} onClick={() => setMode("redeem")}>Списать</button>
        <button aria-pressed={mode === "donate"} onClick={() => { setMode("donate"); setRedeem(null); setOrderId(null); }}>Донат</button>
      </div>

      <div className="field">
        <label htmlFor="f-amount">{mode === "earn" ? "Клиент оплатил" : mode === "donate" ? "Сумма доната" : "Сумма заказа"}</label>
        <div className="amount">
          <input
            id="f-amount"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            value={amount ? fmt(amount) : ""}
            onChange={(e) => setAmount(Math.min(digits(e.target.value), 10_000_000))}
          />
          <span>₽</span>
        </div>
        <div className="presets">
          {PRESETS.map((v) => <button key={v} onClick={() => setAmount(v)}>{fmt(v)}</button>)}
        </div>
      </div>

      {mode === "redeem" && (
        <div className="field">
          <label htmlFor="f-redeem">Списать АРТов</label>
          <input
            id="f-redeem"
            className="input mono"
            inputMode="numeric"
            placeholder={q ? `максимум ${fmt(q.max_redeem)}` : "максимум"}
            value={redeem ?? ""}
            onChange={(e) => setRedeem(e.target.value.trim() === "" ? null : digits(e.target.value))}
          />
          {q && (
            <div className="sm muted" style={{ lineHeight: 1.5 }}>
              Лимит «{q.tier.name}»: {pct(q.tier.pay_pct)}% заказа = {fmt(q.pay_limit)} АРТ.
              {q.foreign_cap !== null && q.foreign_available > 0 && ` АРТов других художников — не больше ${fmt(q.foreign_cap)}.`}
              {" "}Можно списать до {fmt(q.max_redeem)}.
            </div>
          )}
        </div>
      )}

      {q && !done && (
        <div className="summary">
          {mode === "donate" ? (
            <div className="kv"><span className="muted">АРТы за донат</span><span>по вашей ставке (Настройки → Донаты)</span></div>
          ) : mode === "earn" ? (
            <>
              <div className="kv"><span className="muted">Уровень клиента</span><span>{q.tier.name} · {pct(q.tier.earn_pct)}%</span></div>
              {q.promotion && <div className="kv"><span className="muted">Акция «{q.promotion.title}»</span><span>×{pct(q.promotion.multiplier)}</span></div>}
              {!!q.birthday_boost && <div className="kv"><span className="muted">День рождения</span><span>+{pct(q.birthday_boost)}%</span></div>}
              <div className="kv"><span className="muted">Сумма заказов после</span><span>{fmt(q.spent_after)} ₽</span></div>
              <div className="kv"><span className="muted">Баланс после</span><span>{fmt(q.balance_after)} АРТ</span></div>
              <div className="res"><span className="soft sm">Начислим</span><b>+{fmt(q.earn)} АРТ</b></div>
            </>
          ) : (
            <>
              <div className="kv"><span className="muted">Клиент доплачивает</span><span>{fmt(q.paid)} ₽</span></div>
              {!!q.gift_used && <div className="kv"><span className="muted">Из них сертификатом</span><span>{fmt(q.gift_used)} АРТ</span></div>}
              <div className="kv"><span className="muted">Начислим за доплату</span><span>+{fmt(q.earn)} АРТ · {pct(q.tier.earn_pct)}%</span></div>
              <div className="kv"><span className="muted">Баланс после</span><span>{fmt(q.balance_after)} АРТ</span></div>
              <div className="res"><span className="soft sm">Спишем</span><b>−{fmt(q.redeem)} АРТ</b></div>
            </>
          )}
        </div>
      )}
      {overLimit && q && <div className="notice bad">Больше {fmt(q.max_redeem)} АРТ списать нельзя: ограничение уровня или баланса.</div>}
      {q?.tier_up && !done && <div className="notice blue">После этого заказа {q.member.name} перейдёт на уровень «{q.new_tier.name}».</div>}
      {done && (
        <div className="notice ok">
          Готово: {signed(done.points)} АРТ. Уведомление ушло клиенту в бот. Отменить операцию можно в течение 24 часов во вкладке «Операции».
        </div>
      )}

      {!done && me.artist && (
        <div className="hint">
          Начислять можно и прямо в переписке с клиентом: наберите <span className="mono gold">@{import.meta.env.VITE_BOT_USERNAME || "бот"} 3000</span> и отправьте карточку.
        </div>
      )}

      <div className="cta">
        {done ? (
          <button className="btn btn-primary" onClick={reset}>Новая операция</button>
        ) : (
          <button className="btn btn-primary" disabled={!canCommit} onClick={commit}>{busy ? "Проводим…" : label}</button>
        )}
      </div>
    </>
  );
}
