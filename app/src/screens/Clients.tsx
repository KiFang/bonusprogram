import { useLoad, type TierInfo } from "../api";
import { joinLink, useNav } from "../nav";
import { copyText, ErrorBox, fmt, Loading, Progress, Section, TierChip, tierColor } from "../ui";

type Client = { name: string; code: string; username: string | null; tier: TierInfo; balance: number };

export function Clients() {
  const { me, push, toast } = useNav();
  const { data, error, loading, reload } = useLoad<Client[]>("clients");
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Не удалось загрузить"} onRetry={reload} />;

  const program = me.artist!.program;
  const link = joinLink(program.slug);
  const counts: Record<number, { name: string; n: number }> = {};
  data.forEach((c) => {
    counts[c.tier.index] = { name: c.tier.name, n: (counts[c.tier.index]?.n ?? 0) + 1 };
  });

  return (
    <>
      <div className="linkcard">
        <div className="eyebrow">Ссылка для клиентов</div>
        <div className="mono sm gold" style={{ wordBreak: "break-all" }}>{link}</div>
        <button className="btn btn-sm" onClick={async () => toast((await copyText(link)) ? "Ссылка скопирована" : "Скопируйте ссылку вручную")}>Скопировать</button>
      </div>

      {Object.keys(counts).length > 0 && (
        <Section title="По уровням">
          <div className="row2">
            {Object.entries(counts).map(([i, c]) => (
              <div className="stat" key={i}>
                <span className="sm" style={{ color: tierColor(Number(i)), font: "600 11px var(--display)" }}>{c.name}</span>
                <span className="h2">{c.n}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={`Участники «${program.name}»`} aside={String(data.length)}>
        {data.length === 0 ? (
          <div className="sm muted">Пока никого. Отправьте клиентам ссылку выше.</div>
        ) : (
          <div className="list">
            {data.map((c) => (
              <button className="li" key={c.code} onClick={() => push({ name: "cassa", code: c.code })}>
                <div className="avatar" style={{ width: 36, height: 36, background: "var(--line2)", color: "var(--text)" }}>{c.name.slice(0, 1)}</div>
                <div className="li-main">
                  <div className="li-top">
                    <span style={{ fontWeight: 500 }}>{c.name} <span className="mono muted sm">{c.code}</span></span>
                    <TierChip name={c.tier.name} index={c.tier.index} />
                  </div>
                  <Progress value={c.tier.progress} color={tierColor(c.tier.index)} />
                  <div className="mono muted xs">у вас {fmt(c.tier.spent)} ₽ · кошелёк {fmt(c.balance)} АРТ</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
