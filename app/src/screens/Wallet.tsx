import { useNav } from "../nav";
import { Avatar, fmt, Icon, Progress, Section, stars, TierChip, tierColor } from "../ui";

export function Wallet() {
  const { me, push, reset } = useNav();

  return (
    <>
      <div className="hello">
        <div>
          <div className="muted sm">Привет</div>
          <div className="h2">{me.user.name}</div>
        </div>
        <button className="code-chip" onClick={() => reset({ name: "code" })} aria-label="Показать мой код">
          <span style={{ color: "var(--ochre)", display: "flex" }}>{Icon.qr}</span>
          {me.user.code}
        </button>
      </div>

      {me.programs.length === 0 && (
        <div className="empty">
          <div className="h2" style={{ fontSize: 16 }}>Вы пока не в программе</div>
          <div className="soft">
            Откройте ссылку художника или отправьте боту команду <span className="mono gold">/bonusp &lt;группа или ник&gt;</span>.
          </div>
        </div>
      )}

      {me.programs.map((p) => {
        const group = p.type === "group";
        return (
          <div className="sec" key={p.id}>
            <div className={"wcard" + (group ? "" : " solo")}>
              <div className="hatch" />
              <div className="wtop">
                <div className="stack-col">
                  <div className="eyebrow">{group ? "Общий кошелёк коллектива" : "Личный кошелёк художника"}</div>
                  <div className="h2" style={{ fontSize: 18 }}>{p.name}</div>
                </div>
                <div className="avatars">
                  {p.artists.map((a) => <Avatar key={a.id} artist={a} size={30} />)}
                </div>
              </div>
              <div className="stack-col">
                <div className="balance">
                  <div className="num">{fmt(p.balance)}</div>
                  <div className="cur">АРТ</div>
                </div>
                <div className="conv">≈ {fmt(p.balance)} ₽ · {stars(p.balance)} {Icon.star}</div>
              </div>
              <div className="row2">
                <button className="btn btn-primary" onClick={() => reset({ name: "code" })}>Показать код</button>
                <button className="btn" onClick={() => push({ name: "history", programId: p.id })}>История</button>
              </div>
            </div>

            <Section title={group ? "Ваш уровень у художников" : "Ваш уровень"} aside="по сумме заказов">
              <div className="list">
                {p.artists.map((a) => {
                  const t = p.tiers[a.id];
                  if (!t) return null;
                  return (
                    <button className="li" key={a.id} onClick={() => push({ name: "artist", id: a.id })}>
                      <Avatar artist={a} />
                      <div className="li-main">
                        <div className="li-top">
                          <span style={{ fontWeight: 500 }}>@{a.nick}</span>
                          <TierChip name={t.name} index={t.index} />
                        </div>
                        <Progress value={t.progress} color={tierColor(t.index)} />
                        <div className="mono muted xs">
                          {t.next ? `${fmt(t.spent)} / ${fmt(t.next.min_spent)} ₽ до «${t.next.name}»` : `Максимальный уровень · ${fmt(t.spent)} ₽`}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>
          </div>
        );
      })}
    </>
  );
}
