import { notFound } from "next/navigation";
import "@fontsource/amatic-sc/cyrillic-700.css";
import "@fontsource/amatic-sc/latin-700.css";
import "@fontsource/bad-script/cyrillic-400.css";
import "@fontsource/bad-script/latin-400.css";
import "@fontsource/caveat/cyrillic-700.css";
import "@fontsource/caveat/latin-700.css";
import "@fontsource/marck-script/cyrillic-400.css";
import "@fontsource/marck-script/latin-400.css";
import "@fontsource/neucha/cyrillic-400.css";
import "@fontsource/neucha/latin-400.css";
import "@fontsource/pangolin/cyrillic-400.css";
import "@fontsource/pangolin/latin-400.css";
import "@fontsource/rubik-doodle-shadow/cyrillic-400.css";
import "@fontsource/rubik-doodle-shadow/latin-400.css";
import "@fontsource/rubik-scribble/cyrillic-400.css";
import "@fontsource/rubik-scribble/latin-400.css";
import "@fontsource/underdog/cyrillic-400.css";
import "@fontsource/underdog/latin-400.css";

// Образцы заголовочных шрифтов. Страница служебная: в продакшене закрыта, если не задано ENABLE_DEV_PAGES=1.
const FONTS: { name: string; family: string; weight: number; note: string }[] = [
  { name: "Comfortaa", family: "Comfortaa", weight: 700, note: "круглый, строгий, геометрия без «скетча» (сейчас в каркасе)" },
  { name: "Rubik Scribble", family: "Rubik Scribble", weight: 400, note: "буквы Rubik, заштрихованные карандашом: самый «неоконченный»" },
  { name: "Rubik Doodle Shadow", family: "Rubik Doodle Shadow", weight: 400, note: "круглый, с рисованной тенью, узнаваемо «дудл»" },
  { name: "Pangolin", family: "Pangolin", weight: 400, note: "мягкий почерк маркером, дружелюбный, хорошо читается" },
  { name: "Neucha", family: "Neucha", weight: 400, note: "рисованный почерк, чуть угловатый, строже Pangolin" },
  { name: "Underdog", family: "Underdog", weight: 400, note: "широкий, неровный, с характером постера" },
  { name: "Amatic SC", family: "Amatic SC", weight: 700, note: "узкий рукописный капслок, очень скетчевый" },
  { name: "Caveat", family: "Caveat", weight: 700, note: "скоропись пером, лёгкая и быстрая" },
  { name: "Marck Script", family: "Marck Script", weight: 400, note: "каллиграфия кистью, нарядная, для коротких слов" },
  { name: "Bad Script", family: "Bad Script", weight: 400, note: "небрежный почерк, намеренно «плохая» пропись" },
];

export const metadata = { title: "Образцы шрифтов", robots: { index: false } };

export default function FontsPage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_PAGES !== "1") notFound();
  return (
    <>
      <section className="hero">
        <span className="eyebrow">служебная страница</span>
        <h1>Образцы шрифтов</h1>
        <p className="lead">Заголовок, цена и название сервиса в каждом шрифте. Основной текст остаётся Rubik. Переключите тему, чтобы посмотреть оба варианта.</p>
      </section>
      <section className="stack" aria-label="Образцы">
        {FONTS.map((f) => (
          <article className="card" key={f.name} style={{ fontFamily: `"${f.family}", var(--font-body)` }}>
            <p className="label" style={{ fontFamily: "var(--font-body)" }}>{f.name}</p>
            <p style={{ fontSize: "clamp(34px, 7vw, 56px)", lineHeight: 1.1, fontWeight: f.weight }}>Заказать рисунок</p>
            <p style={{ fontSize: 26, lineHeight: 1.25, fontWeight: f.weight }}>Прайс-лист · 3 500 ₽ · Скетч, лайн, цвет</p>
            <p style={{ fontSize: 18, fontWeight: f.weight }}>ARTCHIEVE SERVICE — АРТНАДА СЕРВИС</p>
            <p className="hint" style={{ fontFamily: "var(--font-body)" }}>{f.note}</p>
          </article>
        ))}
      </section>
    </>
  );
}
