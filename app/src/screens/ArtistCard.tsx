import { useLoad, type Artist, type Entry, type TierInfo } from "../api";
import { Avatar, ErrorBox, fmt, Icon, Loading, pct, Section, tierColor } from "../ui";
import { EntryRow } from "./History";

type Card = {
  artist: Artist;
  program: { id: string; name: string; type: "group" | "solo" };
  tiers: { index: number; name: string; min_spent: number; earn_pct: number; pay_pct: number; foreign_pct: number; perks: string }[];
  my_tier: TierInfo;
  history: Entry[];
};

export function ArtistCard({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad<Card>("artist_card", { artist_id: id });
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
