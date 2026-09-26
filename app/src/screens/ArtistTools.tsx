import { useEffect, useState } from "react";
import { call, useLoad, type Certificate, type Fundraiser, type Program, type Promotion, type Slots } from "../api";
import { useNav, type Route } from "../nav";
import { haptic, shareLink } from "../tg";
import { copyText, digits, dmy, ErrorBox, fmt, hm, Loading, Section } from "../ui";

/** Раздел «Настройки» художника. */
export function More() {
  const { me, push, showTutorial } = useNav();
  const items: [Route, string, string][] = [
    [{ name: "settings" }, "Уровни и этапы", "Пороги, проценты, ранний доступ, шаблон этапов заказа"],
    [{ name: "slots" }, "Слоты", "Открыть запись, уйти в отдых или брать без лимита"],
    [{ name: "promotions" }, "Акции", "Множитель АРТов на время, например ×2 на выходных"],
    [{ name: "certificates" }, "Сертификаты", "Выпустить подарочный сертификат и отправить клиенту"],
    [{ name: "donations" }, "Донаты", "Ссылки для поддержки и АРТы за донаты"],
    [{ name: "program" }, me.artist?.is_group_admin ? "Программа" : "Программа (просмотр)", "Приведи друга, день рождения, общий сбор"],
  ];
  return (
    <>
      <div className="h2">Настройки</div>
      <div className="list">
        {items.map(([r, title, hint]) => (
          <button className="li" key={title} onClick={() => push(r)}>
            <div className="li-main">
              <span style={{ fontWeight: 500 }}>{title}</span>
              <span className="sm muted">{hint}</span>
            </div>
            <span className="muted" aria-hidden="true">›</span>
          </button>
        ))}
      </div>
      <button className="btn btn-ghost" onClick={() => showTutorial("artist")}>Обучение художника</button>
    </>
  );
}

// ---- Слоты ----

export function SlotsScreen() {
  const { toast } = useNav();
  const { data, error, loading, reload } = useLoad<{ slots: Slots; artist: { slots_total: number } }>("settings");
  const [mode, setMode] = useState<Slots["mode"]>("unlimited");
  const [total, setTotal] = useState(3);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setMode(data.slots.mode);
    setTotal(data.artist.slots_total || 3);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;
  const s = data.slots;

  async function save() {
    setBusy(true);
    try {
      const r = await call<Slots & { announce: boolean }>("set_slots", { mode, total });
      haptic("success");
      toast(r.announce ? "Слоты открыты, клиенты получили уведомление" : "Сохранено");
      reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="h2">Слоты</div>
      <div className="seg seg3" role="group" aria-label="Режим">
        <button aria-pressed={mode === "open"} onClick={() => setMode("open")}>Открыты</button>
        <button aria-pressed={mode === "rest"} onClick={() => setMode("rest")}>Отдых</button>
        <button aria-pressed={mode === "unlimited"} onClick={() => setMode("unlimited")}>Без лимита</button>
      </div>
      {mode === "open" && (
        <div className="field">
          <label htmlFor="sl-total">Сколько слотов</label>
          <input id="sl-total" className="input mono" inputMode="numeric" value={total || ""} onChange={(e) => setTotal(Math.min(digits(e.target.value), 100))} />
          <div className="sm muted">Занятый слот — это активный заказ. Уровни с ранним доступом (задаётся в «Уровнях») увидят слоты раньше остальных.</div>
        </div>
      )}
      <div className="sm soft" style={{ lineHeight: 1.5 }}>
        {mode === "open" && "Клиенты нажимают «Хочу заказ» в вашей карточке, вы принимаете заявку — и она становится заказом."}
        {mode === "rest" && "Кнопка заявки скрыта, клиенты видят, что вы отдыхаете."}
        {mode === "unlimited" && "Заявки принимаются без ограничения числа."}
      </div>
      <div className="summary">
        <div className="kv"><span className="muted">Сейчас</span><span>{s.mode === "open" ? "открыты" : s.mode === "rest" ? "отдых" : "без лимита"}</span></div>
        <div className="kv"><span className="muted">Активных заказов</span><span>{s.taken}</span></div>
        {s.mode === "open" && <div className="kv"><span className="muted">Свободно</span><span>{s.free} из {s.total}</span></div>}
        {s.opened_at && s.mode === "open" && <div className="kv"><span className="muted">Открыты</span><span>{dmy(s.opened_at)} {hm(s.opened_at)}</span></div>}
      </div>
      <div className="cta"><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Сохраняем…" : "Сохранить"}</button></div>
    </>
  );
}

// ---- Донаты ----

export function DonationsScreen() {
  const { toast } = useNav();
  const { data, error, loading, reload } = useLoad<{ artist: { donate_links: { title: string; url: string }[]; donation_earn_pct: number | null } }>("settings");
  const [links, setLinks] = useState<{ title: string; url: string }[]>([]);
  const [pct, setPct] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setLinks(data.artist.donate_links);
    setPct(data.artist.donation_earn_pct === null ? "" : String(Number(data.artist.donation_earn_pct)));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await call("save_donations", { links: links.filter((l) => l.title.trim() || l.url.trim()), pct: pct.trim() === "" ? null : Number(pct.replace(",", ".")) });
      haptic("success");
      toast("Сохранено");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="h2">Донаты</div>
      <Section title="Ссылки для поддержки">
        {links.map((l, i) => (
          <div className="stage-edit" key={i}>
            <div className="row-input">
              <input className="input" style={{ maxWidth: 130 }} placeholder="Boosty" maxLength={32} value={l.title} aria-label="Название"
                onChange={(e) => setLinks(links.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} />
              <input className="input mono" placeholder="https://" value={l.url} aria-label="Ссылка"
                onChange={(e) => setLinks(links.map((x, k) => (k === i ? { ...x, url: e.target.value.trim() } : x)))} />
              <button className="icon-btn" aria-label="Удалить ссылку" onClick={() => setLinks(links.filter((_, k) => k !== i))}>×</button>
            </div>
          </div>
        ))}
        {links.length < 5 && <button className="btn btn-ghost btn-sm" onClick={() => setLinks([...links, { title: "", url: "" }])}>+ Ссылка</button>}
        <div className="sm muted">Кнопки появятся в вашей карточке у клиентов. Деньги идут напрямую вам.</div>
      </Section>
      <Section title="АРТы за донат">
        <div className="row-input">
          <input className="input mono" inputMode="decimal" placeholder="выключено" value={pct} aria-label="Процент" onChange={(e) => setPct(e.target.value.replace(/[^\d.,]/g, ""))} />
          <span className="muted" style={{ alignSelf: "center" }}>%</span>
        </div>
        <div className="sm muted">Пусто — АРТы за донаты не начисляются. Донаты в уровень не засчитываются. Отметить донат, пришедший напрямую, можно в кассе.</div>
      </Section>
      {err && <ErrorBox message={err} />}
      <div className="cta"><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Сохраняем…" : "Сохранить"}</button></div>
    </>
  );
}

// ---- Акции ----

function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function PromotionsScreen() {
  const { toast } = useNav();
  const { data, error, loading, reload, setData } = useLoad<Promotion[]>("promotions");
  const now = new Date();
  const [title, setTitle] = useState("Двойные АРТы");
  const [mult, setMult] = useState(2);
  const [starts, setStarts] = useState(localInput(now));
  const [ends, setEnds] = useState(localInput(new Date(now.getTime() + 2 * 86400000)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      setData(await call<Promotion[]>("create_promotion", {
        title, multiplier: mult, starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(),
      }));
      haptic("success");
      toast("Акция создана");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      setData(await call<Promotion[]>("delete_promotion", { id }));
      toast("Акция удалена");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <div className="h2">Акции</div>
      {data.length > 0 && (
        <div className="list">
          {data.map((p) => (
            <div className="li" key={p.id}>
              <div className="li-main">
                <div className="li-top"><span style={{ fontWeight: 500 }}>{p.title}</span><span className="status-chip active">×{String(Number(p.multiplier)).replace(".", ",")}</span></div>
                <div className="mono muted xs">{dmy(p.starts_at)} {hm(p.starts_at)} — {dmy(p.ends_at)} {hm(p.ends_at)}{p.active ? " · идёт" : ""}</div>
              </div>
              <button className="btn btn-sm" onClick={() => remove(p.id)}>Удалить</button>
            </div>
          ))}
        </div>
      )}
      <Section title="Новая акция">
        <input className="input" maxLength={60} value={title} aria-label="Название акции" onChange={(e) => setTitle(e.target.value)} />
        <div className="presets">
          {[1.5, 2, 3].map((m) => <button key={m} className={mult === m ? "on" : ""} aria-pressed={mult === m} onClick={() => setMult(m)}>×{String(m).replace(".", ",")}</button>)}
        </div>
        <div className="row2">
          <label className="field"><span className="sm muted">Начало</span><input className="input" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></label>
          <label className="field"><span className="sm muted">Конец</span><input className="input" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></label>
        </div>
        <div className="sm muted">Пока акция идёт, начисление АРТов умножается. Клиенты видят её в вашей карточке.</div>
        {err && <ErrorBox message={err} />}
        <button className="btn btn-primary" disabled={busy} onClick={create}>{busy ? "Создаём…" : "Создать акцию"}</button>
      </Section>
    </>
  );
}

// ---- Сертификаты ----

export function CertificatesScreen() {
  const { me, toast } = useNav();
  const { data, error, loading, reload } = useLoad<Certificate[]>("certificates");
  const group = me.artist?.program.type === "group";
  const [scope, setScope] = useState<"artist" | "group">("artist");
  const [amount, setAmount] = useState(1000);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<(Certificate & { link: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;

  async function issue() {
    setBusy(true);
    setErr(null);
    try {
      const c = await call<Certificate & { link: string }>("issue_certificate", { scope, amount, note });
      haptic("success");
      setIssued(c);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function voidCert(id: string) {
    try {
      await call("void_certificate", { id });
      toast("Сертификат аннулирован");
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const STATUS: Record<Certificate["status"], string> = { issued: "не активирован", activated: "активирован", void: "аннулирован" };

  return (
    <>
      <div className="h2">Подарочные сертификаты</div>
      {issued && (
        <div className="linkcard">
          <div className="eyebrow">Готово</div>
          <div className="h2">{fmt(issued.amount)} АРТ · <span className="mono">{issued.code}</span></div>
          <div className="mono sm gold" style={{ wordBreak: "break-all" }}>{issued.link}</div>
          <div className="row2">
            <button className="btn btn-sm" onClick={() => shareLink(issued.link, `Подарочный сертификат на ${issued.amount} АРТ`)}>Отправить</button>
            <button className="btn btn-sm" onClick={async () => toast((await copyText(issued.link)) ? "Ссылка скопирована" : "Скопируйте вручную")}>Копировать</button>
          </div>
        </div>
      )}
      <Section title="Выпустить">
        {group && (
          <div className="seg" role="group" aria-label="Вид">
            <button aria-pressed={scope === "artist"} onClick={() => setScope("artist")}>Мой</button>
            <button aria-pressed={scope === "group"} onClick={() => setScope("group")}>Группы</button>
          </div>
        )}
        <div className="presets">
          {[500, 1000, 3000, 5000].map((v) => <button key={v} className={amount === v ? "on" : ""} aria-pressed={amount === v} onClick={() => setAmount(v)}>{fmt(v)}</button>)}
        </div>
        <input className="input mono" inputMode="numeric" aria-label="Номинал" value={amount ? fmt(amount) : ""} onChange={(e) => setAmount(Math.min(digits(e.target.value), 1_000_000))} />
        <input className="input" maxLength={120} placeholder="Подпись, например «С днём рождения!»" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="sm muted">
          Выпускайте, когда клиент оплатил сертификат вам напрямую. {scope === "group" ? "Сертификат группы тратится у любого художника без ограничений." : "Ваш сертификат у коллег по группе считается вашими АРТами."} Действует год.
        </div>
        {err && <ErrorBox message={err} />}
        <button className="btn btn-primary" disabled={busy || amount < 100} onClick={issue}>{busy ? "Выпускаем…" : `Выпустить на ${fmt(amount)} АРТ`}</button>
      </Section>
      {data.length > 0 && (
        <Section title="Выпущенные">
          <div className="list">
            {data.map((c) => (
              <div className="li" key={c.id}>
                <div className="li-main">
                  <div className="li-top"><span className="mono">{c.code}</span><span className="pts plus">{fmt(c.amount)}</span></div>
                  <div className="li-top">
                    <span className="muted xs">
                      {c.scope === "group" ? "группы" : `@${c.artist?.nick}`} · {STATUS[c.status]}{c.activated_by ? ` · ${c.activated_by}` : ""}{c.paid_via === "stars" ? " · Stars" : ""} · {dmy(c.created_at)}
                    </span>
                    {c.status === "issued" && c.paid_via === "artist" && <button className="btn btn-sm" onClick={() => voidCert(c.id)}>Аннулировать</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

// ---- Программа: «Приведи друга», день рождения, общий сбор ----

type ProgramSettings = {
  program: Program;
  is_admin: boolean;
  fundraiser: Fundraiser | null;
  settings: {
    referral: { enabled: boolean; friend_bonus: number; referrer_bonus: number; min_order: number };
    birthday: { mode: "off" | "bonus" | "boost"; bonus: number; ttl_days: number; boost_pct: number; window_days: number };
  };
};

function NumField({ label, value, onChange, disabled, suffix }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean; suffix?: string }) {
  return (
    <label className="field">
      <span className="sm muted">{label}</span>
      <div className="row-input">
        <input className="input mono" inputMode="numeric" disabled={disabled} value={String(value)} onChange={(e) => onChange(digits(e.target.value))} />
        {suffix && <span className="muted sm" style={{ alignSelf: "center" }}>{suffix}</span>}
      </div>
    </label>
  );
}

export function ProgramScreen() {
  const { toast } = useNav();
  const { data, error, loading, reload } = useLoad<ProgramSettings>("program_settings");
  const [s, setS] = useState<ProgramSettings["settings"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fTitle, setFTitle] = useState("");
  const [fGoal, setFGoal] = useState(10000);
  const [contrib, setContrib] = useState(0);

  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data || !s) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;
  const ro = !data.is_admin;
  const r = s.referral;
  const b = s.birthday;

  async function run(action: string, params: Record<string, unknown>, ok: string) {
    setBusy(true);
    setErr(null);
    try {
      await call(action, params);
      haptic("success");
      toast(ok);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const f = data.fundraiser;
  return (
    <>
      <div className="h2">Программа «{data.program.name}»</div>
      {ro && <div className="notice blue">Эти настройки меняет админ группы. Вы можете записывать взносы в общий сбор.</div>}

      <Section title="Приведи друга">
        <label className="li radio" style={{ padding: 0 }}>
          <input type="checkbox" checked={r.enabled} disabled={ro} onChange={(e) => setS({ ...s, referral: { ...r, enabled: e.target.checked } })} />
          <span className="li-main"><span>Включено</span><span className="sm muted">Бонусы после первого заказа друга</span></span>
        </label>
        <div className="row2">
          <NumField label="Другу" value={r.friend_bonus} disabled={ro} suffix="АРТ" onChange={(v) => setS({ ...s, referral: { ...r, friend_bonus: v } })} />
          <NumField label="Пригласившему" value={r.referrer_bonus} disabled={ro} suffix="АРТ" onChange={(v) => setS({ ...s, referral: { ...r, referrer_bonus: v } })} />
        </div>
        <NumField label="Минимальный первый заказ" value={r.min_order} disabled={ro} suffix="₽" onChange={(v) => setS({ ...s, referral: { ...r, min_order: v } })} />
      </Section>

      <Section title="День рождения">
        <div className="seg seg3" role="group" aria-label="Режим">
          {(["off", "bonus", "boost"] as const).map((m) => (
            <button key={m} disabled={ro} aria-pressed={b.mode === m} onClick={() => setS({ ...s, birthday: { ...b, mode: m } })}>
              {m === "off" ? "Выкл" : m === "bonus" ? "Подарок" : "Процент"}
            </button>
          ))}
        </div>
        {b.mode === "bonus" && (
          <div className="row2">
            <NumField label="Подарок" value={b.bonus} disabled={ro} suffix="АРТ" onChange={(v) => setS({ ...s, birthday: { ...b, bonus: v } })} />
            <NumField label="Срок" value={b.ttl_days} disabled={ro} suffix="дн." onChange={(v) => setS({ ...s, birthday: { ...b, ttl_days: v } })} />
          </div>
        )}
        {b.mode === "boost" && (
          <div className="row2">
            <NumField label="Прибавка" value={b.boost_pct} disabled={ro} suffix="%" onChange={(v) => setS({ ...s, birthday: { ...b, boost_pct: v } })} />
            <NumField label="Окно ±" value={b.window_days} disabled={ro} suffix="дн." onChange={(v) => setS({ ...s, birthday: { ...b, window_days: v } })} />
          </div>
        )}
        <div className="sm muted">
          {b.mode === "bonus" && "В день рождения клиенту приходит подарок и сообщение в бот."}
          {b.mode === "boost" && "Вокруг дня рождения процент начисления у всех художников программы выше."}
          {b.mode === "off" && "Клиенты указывают дату в профиле."}
        </div>
      </Section>
      {!ro && <button className="btn btn-primary" disabled={busy} onClick={() => run("save_program_settings", { settings: s }, "Сохранено")}>Сохранить настройки</button>}

      {data.program.type === "group" && (
        <Section title="Общий сбор">
          {f ? (
            <div className="linkcard">
              <div style={{ fontWeight: 600 }}>{f.title}</div>
              <div className="bar-track" style={{ width: "100%" }}><div style={{ width: `${Math.min(100, (f.raised / f.goal) * 100)}%`, background: "var(--ochre)" }} /></div>
              <div className="mono sm">{fmt(f.raised)} из {fmt(f.goal)} ₽ · взносов: {f.count}</div>
              <div className="row-input" style={{ width: "100%" }}>
                <input className="input mono" inputMode="numeric" placeholder="Взнос, ₽" value={contrib ? fmt(contrib) : ""} onChange={(e) => setContrib(digits(e.target.value))} />
                <button className="btn" disabled={busy || !contrib} onClick={() => { run("add_contribution", { amount: contrib, note: "" }, "Взнос записан"); setContrib(0); }}>Записать</button>
              </div>
              {!ro && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run("close_fundraiser", {}, "Сбор завершён")}>Завершить сбор</button>}
            </div>
          ) : ro ? (
            <div className="sm muted">Активного сбора нет.</div>
          ) : (
            <>
              <input className="input" maxLength={80} placeholder="Стенд на фестивале" value={fTitle} onChange={(e) => setFTitle(e.target.value)} />
              <NumField label="Цель" value={fGoal} suffix="₽" onChange={setFGoal} />
              <button className="btn" disabled={busy || !fTitle.trim()} onClick={() => run("create_fundraiser", { title: fTitle, goal: fGoal }, "Сбор открыт")}>Открыть сбор</button>
              <div className="sm muted">Прогресс увидят все участники группы в кошельке. Взносы записывайте здесь вручную.</div>
            </>
          )}
        </Section>
      )}
      {err && <ErrorBox message={err} />}
    </>
  );
}
