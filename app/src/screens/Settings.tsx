import { useEffect, useState } from "react";
import { call, useLoad, type Artist, type Program, type Tier } from "../api";
import { useNav } from "../nav";
import { haptic } from "../tg";
import { ErrorBox, fmt, Icon, Loading, Section, tierColor } from "../ui";

type Settings = { artist: Artist; program: Program; tiers: Tier[] };
type Draft = { name: string; min_spent: string; earn_pct: string; pay_pct: string; foreign_pct: string; perks: string };

const toDraft = (t: Tier): Draft => ({
  name: t.name, min_spent: String(t.min_spent), earn_pct: String(Number(t.earn_pct)),
  pay_pct: String(Number(t.pay_pct)), foreign_pct: String(Number(t.foreign_pct)), perks: t.perks,
});
const num = (s: string) => Number(String(s).replace(",", ".").replace(/[^\d.]/g, "")) || 0;
const EXAMPLE = 5000;

export function Settings() {
  const { toast, reloadMe } = useNav();
  const { data, error, loading, reload } = useLoad<Settings>("settings");
  const [tiers, setTiers] = useState<Draft[]>([]);
  const [foreignMode, setForeignMode] = useState<"unlimited" | "by_tier">("unlimited");
  const [ttl, setTtl] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setTiers(data.tiers.map(toDraft));
    setForeignMode(data.artist.foreign_mode);
    setTtl(data.artist.points_ttl_days ? String(data.artist.points_ttl_days) : "");
    setBio(data.artist.bio);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;

  const group = data.program.type === "group";
  const byTier = group && foreignMode === "by_tier";
  const upd = (i: number, f: keyof Draft, v: string) => {
    setSaveError(null);
    setTiers((t) => t.map((x, k) => (k === i ? { ...x, [f]: v } : x)));
  };

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await call("save_settings", {
        tiers: tiers.map((t, i) => ({
          name: t.name.trim(), min_spent: i === 0 ? 0 : Math.round(num(t.min_spent)),
          earn_pct: num(t.earn_pct), pay_pct: num(t.pay_pct), foreign_pct: num(t.foreign_pct), perks: t.perks.trim(),
        })),
        settings: { foreign_mode: foreignMode, points_ttl_days: ttl.trim() ? Math.round(num(ttl)) : "", bio: bio.trim() },
      });
      haptic("success");
      toast("Настройки сохранены");
      await Promise.all([reload(), reloadMe()]);
    } catch (e) {
      haptic("error");
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Section title="Программа">
        <div className="list">
          <div className="li" style={{ background: "var(--ochre-bg)" }}>
            <div className="li-main">
              <div style={{ fontWeight: 500 }}>{group ? `Общий кошелёк: коллектив «${data.program.name}»` : "Личный кошелёк"}</div>
              <div className="sm muted">
                {group ? `АРТы можно тратить у всех ${data.program.artists.length} художников группы` : "АРТы тратятся только у вас"}
              </div>
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="s-bio">О себе</label>
          <input id="s-bio" className="input" maxLength={200} value={bio} placeholder="Иллюстрация · персонажи · портреты" onChange={(e) => setBio(e.target.value)} />
        </div>
      </Section>

      {group && (
        <Section title="АРТы коллег по группе">
          <div className="list">
            <label className="li radio">
              <input type="radio" name="foreign" checked={foreignMode === "unlimited"} onChange={() => setForeignMode("unlimited")} />
              <span className="li-main"><span style={{ fontWeight: 500 }}>Принимаю без ограничений</span><span className="sm muted">Клиент тратит любые АРТы группы в пределах лимита уровня</span></span>
            </label>
            <label className="li radio">
              <input type="radio" name="foreign" checked={foreignMode === "by_tier"} onChange={() => setForeignMode("by_tier")} />
              <span className="li-main"><span style={{ fontWeight: 500 }}>Ограничиваю по уровням</span><span className="sm muted">На каждом уровне задаёте, какую часть заказа можно оплатить АРТами, заработанными у коллег</span></span>
            </label>
          </div>
        </Section>
      )}

      <div className="sec-head"><div className="eyebrow">Уровни лояльности</div><div className="mono sm muted">1 АРТ = 1 ₽</div></div>
      {tiers.map((t, i) => (
        <div className="tedit" key={i}>
          <div className="namerow">
            <span className="dot" style={{ width: 10, height: 10, background: tierColor(i) }} />
            <input aria-label={`Название уровня ${i + 1}`} value={t.name} maxLength={32} style={{ color: tierColor(i) }} onChange={(e) => upd(i, "name", e.target.value)} />
            <span className="mono sm muted">{i + 1}</span>
            {tiers.length > 1 && (
              <button className="icon-btn" aria-label={`Удалить уровень ${i + 1}`} onClick={() => setTiers((x) => x.filter((_, k) => k !== i))}>{Icon.trash}</button>
            )}
          </div>
          <div className={"grid " + (byTier ? "g4" : "g3")}>
            <label>Порог, ₽<input inputMode="numeric" value={i === 0 ? "0" : t.min_spent} readOnly={i === 0} onChange={(e) => upd(i, "min_spent", e.target.value)} /></label>
            <label>Копит, %<input inputMode="decimal" value={t.earn_pct} onChange={(e) => upd(i, "earn_pct", e.target.value)} /></label>
            <label>Платит до, %<input inputMode="decimal" value={t.pay_pct} onChange={(e) => upd(i, "pay_pct", e.target.value)} /></label>
            {byTier && <label>Чужие до, %<input inputMode="decimal" value={t.foreign_pct} onChange={(e) => upd(i, "foreign_pct", e.target.value)} /></label>}
          </div>
          <input className="perks" aria-label={`Привилегии уровня ${i + 1}`} value={t.perks} maxLength={300} placeholder="Привилегии через «·»" onChange={(e) => upd(i, "perks", e.target.value)} />
          <div className="preview">
            Заказ {fmt(EXAMPLE)} ₽ → +{fmt(Math.floor((EXAMPLE * num(t.earn_pct)) / 100))} АРТ · АРТами до {fmt(Math.floor((EXAMPLE * num(t.pay_pct)) / 100))} ₽
            {byTier && `, из них чужими до ${fmt(Math.floor((EXAMPLE * num(t.foreign_pct)) / 100))}`}
          </div>
        </div>
      ))}
      {tiers.length < 5 && (
        <button
          className="btn btn-ghost"
          onClick={() => {
            const last = tiers[tiers.length - 1];
            setTiers([...tiers, {
              name: "Новый уровень", min_spent: String(num(last.min_spent) + 20000),
              earn_pct: String(Math.min(100, num(last.earn_pct) + 2)), pay_pct: String(Math.min(100, num(last.pay_pct) + 10)),
              foreign_pct: last.foreign_pct, perks: "",
            }]);
          }}
        >
          + Добавить уровень
        </button>
      )}

      <Section title="Срок жизни АРТов">
        <div className="field">
          <label htmlFor="s-ttl">Сколько дней действуют АРТы, заработанные у вас</label>
          <input id="s-ttl" className="input mono" inputMode="numeric" value={ttl} placeholder="Бессрочно" onChange={(e) => setTtl(e.target.value.replace(/\D/g, ""))} />
        </div>
      </Section>

      {saveError && <ErrorBox message={saveError} />}
      <div className="sm muted" style={{ lineHeight: 1.5 }}>Изменения не пересчитывают прошлые операции: в истории сохраняется уровень на момент заказа.</div>
      <div className="cta">
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Сохраняем…" : "Сохранить"}</button>
      </div>
    </>
  );
}
