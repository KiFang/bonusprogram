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
import { ArtistOrders, MyOrders } from "./screens/Orders";
import { OrderDetail } from "./screens/OrderDetail";
import { NewOrder } from "./screens/NewOrder";
import { Collection } from "./screens/Collection";
import { Profile } from "./screens/Profile";
import { Gift } from "./screens/Gift";
import { Onboarding, type TutorialRole } from "./screens/Onboarding";
import { CertificatesScreen, DonationsScreen, More, ProgramScreen, PromotionsScreen, SlotsScreen } from "./screens/ArtistTools";

const ARTIST_TABS = ["cassa", "orders", "clients", "ops", "more"] as const;

function initialRoute(): Route {
  const sp = tg?.initDataUnsafe?.start_param ?? "";
  if (sp.startsWith("j_")) return { name: "join", query: sp.slice(2) };
  if (sp.startsWith("inv_")) return { name: "invite", code: sp.slice(4) };
  if (sp.startsWith("gift_")) return { name: "gift", code: sp.slice(5) };
  return { name: "wallet" };
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<Route[]>(() => [initialRoute()]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [tutorial, setTutorial] = useState<TutorialRole | null>(null);
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
    if (!inTelegram) return;
    const sp = tg?.initDataUnsafe?.start_param ?? "";
    // Реферальная ссылка: запоминаем пригласившего до первой загрузки кошелька.
    const ref = sp.startsWith("ref_") ? call("set_referrer", { code: sp.slice(4) }).catch(() => null) : Promise.resolve(null);
    ref.then(loadMe);
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
      showTutorial: setTutorial,
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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  // Мини-обучение при первом входе: художнику — про кассу, участнику — про кошелёк.
  const role: TutorialRole | null = !me ? null
    : me.artist ? (me.onboarded.artist ? null : "artist")
    : me.onboarded.member || stack[0].name === "invite" ? null : "member";
  useEffect(() => {
    if (role) setTutorial(role);
  }, [role]);

  function finishTutorial() {
    const done = tutorial;
    setTutorial(null);
    if (!done || !me || me.onboarded[done]) return;
    setMe({ ...me, onboarded: { ...me.onboarded, [done]: true } });
    call("onboarded", { role: done }).catch(() => null);
  }

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

  const artistMode = (ARTIST_TABS as readonly string[]).includes(stack[0].name);
  const tabs: [Route["name"], string, JSX.Element][] = artistMode
    ? [["cassa", "Касса", Icon.cash], ["orders", "Заказы", Icon.brush], ["clients", "Клиенты", Icon.people], ["ops", "Операции", Icon.list], ["more", "Настройки", Icon.sliders]]
    : [["wallet", "Кошелёк", Icon.wallet], ["myorders", "Заказы", Icon.brush], ["collection", "Коллекция", Icon.image], ["profile", "Профиль", Icon.user]];
  const rootName = stack[0].name;

  return (
    <NavContext.Provider value={nav}>
      <div className={"screen" + (stack.length === 1 ? "" : " no-nav")}>
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
        {tutorial && <Onboarding role={tutorial} onDone={finishTutorial} />}
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
    case "cassa": return <Cassa initialCode={r.code} initialOrderId={r.orderId} />;
    case "orders": return <ArtistOrders />;
    case "myorders": return <MyOrders />;
    case "order": return <OrderDetail id={r.id} />;
    case "neworder": return <NewOrder code={r.code} />;
    case "collection": return <Collection />;
    case "profile": return <Profile />;
    case "gift": return <Gift code={r.code} />;
    case "more": return <More />;
    case "slots": return <SlotsScreen />;
    case "donations": return <DonationsScreen />;
    case "promotions": return <PromotionsScreen />;
    case "certificates": return <CertificatesScreen />;
    case "program": return <ProgramScreen />;
    case "ops": return <Operations />;
    case "clients": return <Clients />;
    case "settings": return <Settings />;
  }
}
