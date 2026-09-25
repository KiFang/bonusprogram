import { useState } from "react";
import { call, useLoad, type Artist, type Entry, type Promotion, type Slots, type TierInfo } from "../api";
import { useNav } from "../nav";
import { StarsPay } from "../stars";
import { haptic, openExternal } from "../tg";
import { Avatar, dmy, ErrorBox, fmt, hm, Icon, Loading, pct, Section, tierColor } from "../ui";
import { EntryRow } from "./History";

type Card = {
  artist: Artist & { donate_links: { title: string; url: string }[]; donation_earn_pct: number | null };
  slots: Slots;
  promotion: Promotion | null;
  is_member: boolean;
  program: { id: string; name: string; type: "group" | "solo" };
  tiers: { index: number; name: string; min_spent: number; earn_pct: number; pay_pct: number; foreign_pct: number; perks: string }[];
  my_tier: TierInfo;
  history: Entry[];
};

export function ArtistCard({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad<Card>("artist_card", { artist_id: id });
  const [giftScope, setGiftScope] = useState<"artist" | "group">("artist");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;
  const { artist: a, my_tier: t, tiers, program } = data;

  return (
    <>
      <div className="hero">
        <Avatar artist={a} size={56} />
        <div className="stack-col">
          <div className="h2" style={{ fontSize: 18 }}>@{a.nick}</div>
          {a.bio && <div className="sm muted">{a.bio}</div>}
        </div>
      </div>

      {data.promotion && (
        <div className="notice ok">
          Акция «{data.promotion.title}»: АРТы ×{String(Number(data.promotion.multiplier)).replace(".", ",")} до {dmy(data.promotion.ends_at)} {hm(data.promotion.ends_at)}
        </div>
      )}

      <SlotsBlock artistId={a.id} slots={data.slots} isMember={data.is_member} onChange={reload} />

      <div className="tiercard">
        <div className="sec-head">
          <div className="eyebrow">Ваш уровень</div>
          <div className="mono sm muted">{t.index + 1} из {t.count}</div>
        </div>
        <div className="tiername" style={{ color: tierColor(t.index) }}>{t.name}</div>
        <div className="ladder" style={{ gridTemplateColumns: `repeat(${t.count}, minmax(0, 1fr))` }}>
          {tiers.map((x) => (
            <div key={x.index}>
              <div style={{ width: `${x.index <= t.index ? 100 : x.index === t.index + 1 ? t.progress : 0}%`, background: tierColor(x.index) }} />
            </div>
          ))}
        </div>
        <div className="mono sm soft spread">
          <span>{fmt(t.spent)} ₽ заказов</span>
          <span>{t.next ? `ещё ${fmt(t.next.min_spent - t.spent)} ₽ до «${t.next.name}»` : "максимальный уровень"}</span>
        </div>
      </div>

      <Section title={`Уровни @${a.nick}`}>
        <div className="ttable">
          <div className="trow head"><span>Уровень</span><span>от</span><span>копите</span><span>платите</span></div>
          {tiers.map((x) => (
            <div className={"trow" + (x.index === t.index ? " me" : "")} key={x.index}>
              <span className="n" style={{ color: tierColor(x.index) }}>
                <span className="dot" style={{ background: tierColor(x.index) }} />
                {x.name}
              </span>
              <span>{fmt(x.min_spent)} ₽</span>
              <span>{pct(x.earn_pct)}%</span>
              <span>до {pct(x.pay_pct)}%</span>
            </div>
          ))}
        </div>
        <div className="sm muted" style={{ lineHeight: 1.5 }}>
          «Копите» — какой процент оплаты вернётся АРТами. «Платите» — какую часть заказа можно оплатить АРТами.
          {program.type === "group" && ` АРТы идут в общий кошелёк «${program.name}».`}
          {program.type === "group" && a.foreign_mode === "by_tier" && ` АРТы, заработанные у других художников группы, принимаются здесь до ${pct(t.foreign_pct)}% заказа.`}
          {a.points_ttl_days && ` АРТы от @${a.nick} действуют ${a.points_ttl_days} дн.`}
        </div>
      </Section>

      {t.perks && (
        <Section title={`Привилегии «${t.name}»`}>
          {t.perks.split("·").map((p) => p.trim()).filter(Boolean).map((p) => (
            <div className="perk" key={p}>{Icon.check}<span>{p}</span></div>
          ))}
        </Section>
      )}

      {(a.donate_links.length > 0 || data.is_member) && (
        <Section title="Поддержать художника">
          {a.donate_links.length > 0 && (
            <div className="presets">
              {a.donate_links.map((l) => <button key={l.url} onClick={() => openExternal(l.url)}>{l.title} ↗</button>)}
            </div>
          )}
          <StarsPay kind="donation" targetId={a.id} label="Задонатить" presets={[100, 300, 1000]} min={10} onPaid={reload} />
          {a.donation_earn_pct !== null && Number(a.donation_earn_pct) > 0 && (
            <div className="sm muted">За донат начисляется {pct(a.donation_earn_pct)}% АРТами.</div>
          )}
        </Section>
      )}

      <Section title="Подарочный сертификат">
        {program.type === "group" && (
          <div className="seg" role="group" aria-label="Вид сертификата">
            <button aria-pressed={giftScope === "artist"} onClick={() => setGiftScope("artist")}>@{a.nick}</button>
            <button aria-pressed={giftScope === "group"} onClick={() => setGiftScope("group")}>Вся группа</button>
          </div>
        )}
        <StarsPay kind="certificate" targetId={a.id} scope={giftScope} label="Купить" presets={[1000, 3000, 5000]} min={100} />
        <div className="sm muted">Сертификат придёт вам в бот — перешлите его тому, кому дарите. Можно также купить напрямую у художника.</div>
      </Section>

      <Section title={`История у @${a.nick}`}>
        {data.history.length ? (
          <div className="list">{data.history.map((e) => <EntryRow key={e.id} e={e} />)}</div>
        ) : (
          <div className="sm muted">Операций пока нет.</div>
        )}
      </Section>
    </>
  );
}

function SlotsBlock({ artistId, slots, isMember, onChange }: { artistId: string; slots: Slots; isMember: boolean; onChange: () => void }) {
  const { toast } = useNav();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function request() {
    setBusy(true);
    try {
      await call("request_slot", { artist_id: artistId, comment });
      haptic("success");
      toast("Заявка отправлена художнику");
      setComment("");
      onChange();
    } catch (e) {
      haptic("error");
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    try {
      await call("withdraw_slot", { request_id: slots.pending_request });
      toast("Заявка отозвана");
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status = slots.mode === "rest" ? "Художник отдыхает и сейчас не берёт заказы"
    : slots.mode === "open" ? `Открыто слотов: ${slots.free} из ${slots.total}`
    : "Принимает заказы";
  const waitAccess = slots.mode === "open" && (slots.free ?? 0) > 0 && slots.access_at && new Date(slots.access_at) > new Date();

  return (
    <Section title="Заказы">
      <div className={"notice " + (slots.mode === "rest" ? "bad" : "blue")}>{status}</div>
      {slots.pending_request ? (
        <div className="row2">
          <div className="sm soft" style={{ alignSelf: "center" }}>Ваша заявка ждёт ответа художника.</div>
          <button className="btn btn-sm" disabled={busy} onClick={withdraw}>Отозвать</button>
        </div>
      ) : waitAccess ? (
        <div className="sm muted">Для вашего уровня запись откроется {dmy(slots.access_at!)} в {hm(slots.access_at!)}. Уровни выше получают доступ раньше.</div>
      ) : slots.can_request && isMember ? (
        <>
          <textarea className="input textarea" maxLength={500} placeholder="Что хотите заказать? Можно кратко." value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn btn-primary" disabled={busy} onClick={request}>{busy ? "Отправляем…" : "Хочу заказ"}</button>
        </>
      ) : !isMember && slots.mode !== "rest" ? (
        <div className="sm muted">Чтобы оставить заявку, вступите в программу художника.</div>
      ) : null}
    </Section>
  );
}
