import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "@fontsource/rubik/latin-400.css";
import "@fontsource/rubik/cyrillic-400.css";
import "@fontsource/rubik/latin-500.css";
import "@fontsource/rubik/cyrillic-500.css";
import "@fontsource/rubik/latin-700.css";
import "@fontsource/rubik/cyrillic-700.css";
// Заголовочный шрифт временный: окончательный выбирается по образцам на /dev/fonts.
import "@fontsource/comfortaa/latin-700.css";
import "@fontsource/comfortaa/cyrillic-700.css";
import "./globals.css";
import { ThemeToggle } from "@/components/ThemeToggle";
import { logout } from "@/app/login/actions";
import { ru } from "@/lib/ru.ts";
import { currentUser } from "@/lib/session.ts";

export const metadata: Metadata = {
  title: { default: ru.brandFull, template: `%s · ${ru.brand}` },
  description: "Страница художника, интерактивный прайс, заявки и заказы по этапам.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#111214" },
  ],
};

// Выбранная тема применяется до отрисовки, чтобы страница не мигала.
const THEME_INIT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <header className="top">
          <div className="wrap top-in">
            <Link href="/" className="brand" aria-label={`${ru.brandFull}, на главную`}>
              <b>{ru.brand}</b>
              <small>service</small>
            </Link>
            <nav className="nav" aria-label="Основная навигация">
              <ThemeToggle />
              {user ? (
                <>
                  <Link href="/me" className="btn btn-small">{ru.nav.profile}</Link>
                  <form action={logout}>
                    <button className="btn btn-small btn-ghost">{ru.nav.logout}</button>
                  </form>
                </>
              ) : (
                <Link href="/login" className="btn btn-small btn-primary">{ru.nav.login}</Link>
              )}
            </nav>
          </div>
        </header>
        <div className="wrap main">{children}</div>
        <footer className="foot">
          <div className="wrap foot-in">
            <span>{ru.brandFull} · {ru.brandRu}</span>
            <nav aria-label="Документы">
              <Link href="/terms">Соглашение</Link>
              <Link href="/privacy">Данные</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
