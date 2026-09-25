import { useState } from "react";
import { call, useLoad } from "../api";
import { useNav } from "../nav";
import { haptic, shareLink } from "../tg";
import { copyText, ErrorBox, fmt, Section } from "../ui";
import { MyCode } from "./MyCode";

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

type Referrals = {
  code: string; invited: number; rewarded: number; earned: number; bot: string;
  programs: { name: string; referral: { enabled: boolean; friend_bonus: number; referrer_bonus: number; min_order: number } }[];
};
type Application = { status: "pending" | "approved" | "rejected"; created_at: string } | null;

export function Profile() {
  const { me } = useNav();
  return (
    <>
      <MyCode />
      <Birthday />
      <InviteFriend />
      <GiftActivate />
      {!me.artist && <BecomeArtist />}
    </>
  );
}

function Birthday() {
  const { me, reloadMe, toast } = useNav();
  const [day, setDay] = useState(me.user.birth_day ?? 0);
  const [month, setMonth] = useState(me.user.birth_month ?? 0);
  const [busy, setBusy] = useState(false);
  const changed = day !== (me.user.birth_day ?? 0) || month !== (me.user.birth_month ?? 0);

  async function save() {
    setBusy(true);
    try {
      await call("set_birthday", { day, month });
      haptic("success");
      toast("День рождения сохранён");
      await reloadMe();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="День рождения">
      <div className="row2">
        <select className="input" aria-label="День" value={day} onChange={(e) => setDay(Number(e.target.value))}>
          <option value={0}>День</option>
          {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
        <select className="input" aria-label="Месяц" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          <option value={0}>Месяц</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </div>
      <div className="sm muted">Художники могут дарить АРТы или повышенный процент на день рождения. Дату можно менять раз в год.</div>
      {changed && day > 0 && month > 0 && <button className="btn" disabled={busy} onClick={save}>Сохранить</button>}
    </Section>
  );
}

function InviteFriend() {
  const { toast } = useNav();
  const { data, error, reload } = useLoad<Referrals>("referrals");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  const link = `https://t.me/${data.bot}?start=ref_${data.code.replace("-", "")}`;
  const enabled = data.programs.filter((p) => p.referral.enabled);
  return (
    <Section title="Приведи друга" aside={data.invited ? `приглашено: ${data.invited}` : undefined}>
      <div className="linkcard">
        <div className="sm soft">
          {enabled.length
            ? enabled.map((p) => `«${p.name}»: другу ${fmt(p.referral.friend_bonus)} АРТ, вам ${fmt(p.referral.referrer_bonus)} АРТ после его заказа от ${fmt(p.referral.min_order)} ₽`).join("\n")
            : "В ваших программах бонус за друга пока не включён, но ссылка уже работает: если художник включит его, бонус придёт."}
        </div>
        <div className="mono sm gold" style={{ wordBreak: "break-all" }}>{link}</div>
        <div className="row2">
          <button className="btn btn-sm" onClick={() => shareLink(link, "Присоединяйся к бонусной программе художников Артоки")}>Поделиться</button>
          <button className="btn btn-sm" onClick={async () => toast((await copyText(link)) ? "Ссылка скопирована" : "Скопируйте вручную")}>Копировать</button>
        </div>
        {data.rewarded > 0 && <div className="sm muted">Друзей сделали заказ: {data.rewarded}, вы получили {fmt(data.earned)} АРТ.</div>}
      </div>
    </Section>
  );
}

function GiftActivate() {
  const { push } = useNav();
  const [code, setCode] = useState("");
  return (
    <Section title="Подарочный сертификат">
      <div className="row-input">
        <input className="input mono" placeholder="G-XXXXXXXX" value={code} aria-label="Код сертификата"
          onChange={(e) => setCode(e.target.value.toUpperCase().trim())} />
        <button className="btn" disabled={!/^G-[2-9A-Z]{8}$/.test(code)} onClick={() => push({ name: "gift", code })}>Проверить</button>
      </div>
    </Section>
  );
}

function BecomeArtist() {
  const { me, toast } = useNav();
  const app = useLoad<Application>("my_application");
  const [about, setAbout] = useState("");
  const [links, setLinks] = useState("");
  const [desired, setDesired] = useState("solo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (app.data?.status === "pending") {
    return (
      <Section title="Стать художником">
        <div className="notice blue">Заявка отправлена, админы Артоки рассмотрят её и ответят в боте.</div>
      </Section>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await call("submit_application", { about, links, desired });
      haptic("success");
      toast("Заявка отправлена");
      app.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Стать художником">
      {app.data?.status === "rejected" && <div className="sm muted">Прошлая заявка отклонена. Можно подать новую.</div>}
      {!me.user.username && <div className="notice bad">Сначала задайте username в настройках Telegram: он станет вашим ником в Артоки.</div>}
      <div className="field">
        <label htmlFor="ap-about">О себе и что рисуете</label>
        <textarea id="ap-about" className="input textarea" maxLength={500} value={about} onChange={(e) => setAbout(e.target.value)}
          placeholder="Иллюстрации, персонажи, стикеры. Беру заказы 2 года." />
      </div>
      <div className="field">
        <label htmlFor="ap-links">Портфолио и соцсети</label>
        <input id="ap-links" className="input" maxLength={500} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://t.me/…" />
      </div>
      <div className="field">
        <label htmlFor="ap-desired">Куда</label>
        <input id="ap-desired" className="input mono" value={desired} onChange={(e) => setDesired(e.target.value.toLowerCase().trim())} />
        <div className="sm muted">«solo» — своя программа, или адрес группы, в которую хотите вступить.</div>
      </div>
      {error && <ErrorBox message={error} />}
      <button className="btn btn-primary" disabled={busy || !about.trim() || !me.user.username} onClick={submit}>
        {busy ? "Отправляем…" : "Отправить заявку"}
      </button>
    </Section>
  );
}
