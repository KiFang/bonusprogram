import { useState } from "react";
import { call, useLoad, type Program } from "../api";
import { useNav } from "../nav";
import { haptic } from "../tg";
import { Avatar, ErrorBox, Loading } from "../ui";

export function Join({ query }: { query: string }) {
  const { me, reset, reloadMe, toast } = useNav();
  const { data: p, error, loading } = useLoad<Program>("preview_program", { query });
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  if (loading && !p) return <Loading />;
  if (error || !p) return <ErrorBox message={error ?? "Программа не найдена"} />;

  const already = me.programs.some((x) => x.id === p.id);
  const group = p.type === "group";

  async function join() {
    setBusy(true);
    setJoinError(null);
    try {
      await call("join", { query, source: "link" });
      haptic("success");
      await reloadMe();
      toast(`Вы в программе «${p!.name}»`);
      reset({ name: "wallet" });
    } catch (e) {
      setJoinError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="wcard">
        <div className="hatch" />
        <div className="eyebrow">{group ? "Коллектив художников" : "Бонусная программа художника"}</div>
        <div className="h2" style={{ fontSize: 24 }}>{p.name}</div>
        <div className="list" style={{ background: "var(--app)" }}>
          {p.artists.map((a) => (
            <div className="li" key={a.id}>
              <Avatar artist={a} />
              <div className="li-main">
                <span style={{ fontWeight: 500 }}>@{a.nick}</span>
                {a.bio && <span className="sm muted">{a.bio}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="soft" style={{ lineHeight: 1.55 }}>
        {group
          ? "За каждый оплаченный заказ у художников коллектива вы получаете АРТы в общий кошелёк и тратите их у любого из них. Чем больше заказываете у художника, тем выше ваш уровень у него."
          : "За каждый оплаченный заказ вы получаете АРТы и оплачиваете ими часть следующих заказов. Чем больше заказываете, тем выше уровень."}
      </div>
      {joinError && <ErrorBox message={joinError} />}
      <div className="cta">
        {already ? (
          <button className="btn btn-primary" onClick={() => reset({ name: "wallet" })}>Вы уже в программе. Открыть кошелёк</button>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={join}>{busy ? "Вступаем…" : "Вступить в программу"}</button>
        )}
      </div>
    </>
  );
}
