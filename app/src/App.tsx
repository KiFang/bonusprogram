import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call, type Me } from "./api";
import { NavContext, type Nav, type Route } from "./nav";
import { inTelegram, tg } from "./tg";
import { ErrorBox, Icon, Loading } from "./ui";
import { Wallet } from "./screens/Wallet";
import { MyCode } from "./screens/MyCode";
import { ArtistCard } from "./screens/ArtistCard";
import { History } from "./screens/History";
import { Join } from "./screens/Join";
import { Invite } from "./screens/Invite";
import { Cassa } from "./screens/Cassa";
import { Operations } from "./screens/Operations";
import { Clients } from "./screens/Clients";
import { Settings } from "./screens/Settings";
import { ErrorBoundary } from "./ErrorBoundary";

const ARTIST_TABS = ["cassa", "ops", "clients", "settings"] as const;

function initialRoute(): Route {
  const sp = tg?.initDataUnsafe?.start_param ?? "";
  if (sp.startsWith("j_")) return { name: "join", query: sp.slice(2) };
  if (sp.startsWith("inv_")) return { name: "invite", code: sp.slice(4) };
  return { name: "wallet" };
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<Route[]>(() => [initialRoute()]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number>();

  const loadMe = useCallback(async () => {
    try {
      setError(null);
      setMe(await call<Me>("me"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (inTelegram) loadMe();
  }, [loadMe]);

  const route = stack[stack.length - 1];

  const nav: Nav | null = useMemo(() => {
    if (!me) return null;
    return {
      me,
      route,
      push: (r) => setStack((s) => [...s, r]),
      pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      reset: (r) => setStack([r]),
      reloadMe: loadMe,
      toast: (m) => {
        setToastMsg(m);
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToastMsg(null), 2800);
      },
    };
  }, [me, route, loadMe]);

  // Системная кнопка «Назад» в Telegram.
  useEffect(() => {
    if (!tg) return;
    const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    if (stack.length > 1) {
      tg.BackButton.show();
      tg.BackButton.onClick(back);
    } else tg.BackButton.hide();
    return () => tg?.BackButton.offClick(back);
  }, [stack.length]);

  useEffect(() => window.scrollTo(0, 0), [route]);

  if (!inTelegram) {
    return (
      <div className="screen">
        <div className="content">
          <div className="empty">
            <div className="h2">Откройте Артоки в Telegram</div>
            <div className="soft">Это мини-приложение работает внутри Telegram. Найдите бота Артоки и нажмите кнопку меню.</div>
          </div>
        </div>
      </div>
    );
  }
  if (error && !me) return <div className="screen"><div className="content"><ErrorBox message={error} onRetry={loadMe} /></div></div>;
  if (!nav || !me) return <div className="screen"><div className="content"><Loading /></div></div>;

  const artistMode = (ARTIST_TABS as readonly string[]).includes(route.name);
  const tabs: [Route["name"], string, JSX.Element][] = artistMode
    ? [["cassa", "Касса", Icon.cash], ["ops", "Операции", Icon.list], ["clients", "Клиенты", Icon.people], ["settings", "Уровни", Icon.sliders]]
    : [["wallet", "Кошелёк", Icon.wallet], ["code", "Мой код", Icon.code]];
  const rootName = stack[0].name;

  return (
    <NavContext.Provider value={nav}>
      <div className="screen">
        {me.artist && (
          <div className="modebar" role="group" aria-label="Режим">
            <button aria-pressed={!artistMode} onClick={() => nav.reset({ name: "wallet" })}>Кошелёк</button>
            <button aria-pressed={artistMode} onClick={() => nav.reset({ name: "cassa" })}>Касса художника</button>
          </div>
        )}
        <main className="content" key={stack.length + route.name}>
          <ErrorBoundary onReset={() => nav.reset({ name: "wallet" })}>{renderRoute(route)}</ErrorBoundary>
        </main>
        {stack.length === 1 && (
          <nav className="nav" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map(([name, label, icon]) => (
              <button key={name} aria-current={rootName === name ? "page" : undefined} onClick={() => nav.reset({ name } as Route)}>
                {icon}
                {label}
              </button>
            ))}
          </nav>
        )}
        {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      </div>
    </NavContext.Provider>
  );
}

function renderRoute(r: Route) {
  switch (r.name) {
    case "wallet": return <Wallet />;
    case "code": return <MyCode />;
    case "artist": return <ArtistCard id={r.id} />;
    case "history": return <History programId={r.programId} />;
    case "join": return <Join query={r.query} />;
    case "invite": return <Invite code={r.code} />;
    case "cassa": return <Cassa initialCode={r.code} />;
    case "ops": return <Operations />;
    case "clients": return <Clients />;
    case "settings": return <Settings />;
  }
}
