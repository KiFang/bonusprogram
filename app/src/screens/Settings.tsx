import { useEffect, useState } from "react";
import { call, useLoad, type Artist, type Program, type Tier } from "../api";
import { useNav } from "../nav";
import { haptic } from "../tg";
import { ErrorBox, fmt, Icon, Loading, Section, tierColor } from "../ui";

type Settings = { artist: Artist & { order_stages: string[] }; program: Program; tiers: Tier[] };
type Draft = { name: string; min_spent: string; earn_pct: string; pay_pct: string; foreign_pct: string; perks: string; early_hours: string };

const toDraft = (t: Tier): Draft => ({
  name: t.name, min_spent: String(t.min_spent), earn_pct: String(Number(t.earn_pct)),
  pay_pct: String(Number(t.pay_pct)), foreign_pct: String(Number(t.foreign_pct)), perks: t.perks,
  early_hours: String(t.early_hours ?? 0),
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
  const [stages, setStages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setTiers(data.tiers.map(toDraft));
    setForeignMode(data.artist.foreign_mode);
    setTtl(data.artist.points_ttl_days ? String(data.artist.points_ttl_days) : "");
    setBio(data.artist.bio);
    setStages(data.artist.order_stages);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;

  const initial = JSON.stringify({
    tiers: data.tiers.map(toDraft), foreignMode: data.artist.foreign_mode,
    ttl: data.artist.points_ttl_days ? String(data.artist.points_ttl_days) : "", bio: data.artist.bio,
  });
  const dirtyMain = JSON.stringify({ tiers, foreignMode, ttl, bio }) !== initial;
  const dirtyStages = JSON.stringify(stages) !== JSON.stringify(data.artist.order_stages);
  const dirty = dirtyMain || dirtyStages;
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
      if (dirtyStages) setStages(await call<string[]>("save_stages", { stages: stages.map((x) => x.trim()) }));
      if (dirtyMain) await call("save_settings", {
        tiers: tiers.map((t, i) => ({
          name: t.name.trim(), min_spent: i === 0 ? 0 : Math.round(num(t.min_spent)),
          earn_pct: num(t.earn_pct), pay_pct: num(t.pay_pct), foreign_pct: num(t.foreign_pct), perks: t.perks.trim(),
          early_hours: Math.round(num(t.early_hours)),
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
      <div className="hint">
        Уровень клиента растёт с суммой его заказов у вас. «Начисляем» — какой процент оплаты вернётся клиенту АРТами.
        «Оплата АРТами» — какую часть заказа он сможет ими закрыть. Под каждым уровнем — пример на заказ {fmt(EXAMPLE)} ₽.
      </div>
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
          <div className="grid g4">
            <label>С суммы заказов, ₽<input inputMode="numeric" value={i === 0 ? "0" : t.min_spent} readOnly={i === 0} onChange={(e) => upd(i, "min_spent", e.target.value)} /></label>
            <label>Начисляем, %<input inputMode="decimal" value={t.earn_pct} onChange={(e) => upd(i, "earn_pct", e.target.value)} /></label>
            <label>Оплата АРТами до, %<input inputMode="decimal" value={t.pay_pct} onChange={(e) => upd(i, "pay_pct", e.target.value)} /></label>
            {byTier && <label>Из них АРТами коллег, %<input inputMode="decimal" value={t.foreign_pct} onChange={(e) => upd(i, "foreign_pct", e.target.value)} /></label>}
            <label>Ранний доступ к слотам, ч<input inputMode="numeric" value={t.early_hours} onChange={(e) => upd(i, "early_hours", e.target.value)} /></label>
          </div>
          <input className="perks" aria-label={`Привилегии уровня ${i + 1}`} value={t.perks} maxLength={300} placeholder="Привилегии уровня, через «·» — клиенты увидят их в вашей карточке" onChange={(e) => upd(i, "perks", e.target.value)} />
          <div className="preview">
            Заказ {fmt(EXAMPLE)} ₽: клиент получит +{fmt(Math.floor((EXAMPLE * num(t.earn_pct)) / 100))} АРТ и сможет оплатить АРТами до {fmt(Math.floor((EXAMPLE * num(t.pay_pct)) / 100))} ₽
            {byTier && `, из них АРТами коллег до ${fmt(Math.floor((EXAMPLE * num(t.foreign_pct)) / 100))}`}
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
              foreign_pct: last.foreign_pct, perks: "", early_hours: last.early_hours,
            }]);
          }}
        >
          + Добавить уровень
        </button>
      )}

      <StageTemplate stages={stages} setStages={setStages} />

      <Section title="Срок жизни АРТов">
        <div className="field">
          <label htmlFor="s-ttl">Сколько дней действуют АРТы, заработанные у вас</label>
          <input id="s-ttl" className="input mono" inputMode="numeric" value={ttl} placeholder="Бессрочно" onChange={(e) => setTtl(e.target.value.replace(/\D/g, ""))} />
          <div className="hint">Пусто — АРТы не сгорают. Срок считается от дня начисления.</div>
        </div>
      </Section>

      {saveError && <ErrorBox message={saveError} />}
      <div className="sm muted" style={{ lineHeight: 1.5 }}>Изменения не пересчитывают прошлые операции: в истории сохраняется уровень на момент заказа.</div>
      <div className="cta">
        <button className="btn btn-primary" disabled={saving || !dirty} onClick={save}>{saving ? "Сохраняем…" : dirty ? "Сохранить изменения" : "Всё сохранено"}</button>
      </div>
    </>
  );
}

/** Шаблон этапов для новых заказов. Сохраняется общей кнопкой вместе с уровнями. */
function StageTemplate({ stages, setStages }: { stages: string[]; setStages: (s: string[]) => void }) {
  return (
    <Section title="Этапы заказа">
      <div className="stage-edit">
        {stages.map((s, i) => (
          <div className="row-input" key={i}>
            <span className="mono muted sm" style={{ width: 18, alignSelf: "center" }}>{i + 1}</span>
            <input className="input" maxLength={32} value={s} aria-label={`Этап ${i + 1}`}
              onChange={(e) => setStages(stages.map((x, k) => (k === i ? e.target.value : x)))} />
            {stages.length > 2 && (
              <button className="icon-btn" aria-label={`Удалить этап ${i + 1}`} onClick={() => setStages(stages.filter((_, k) => k !== i))}>{Icon.trash}</button>
            )}
          </div>
        ))}
        {stages.length < 8 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setStages([...stages.slice(0, -1), "Новый этап", stages[stages.length - 1]])}>+ Этап</button>
        )}
      </div>
      <div className="sm muted">Шаблон для новых заказов: клиент видит, на каком этапе его заказ. Последний этап означает «готово».</div>
    </Section>
  );
}
