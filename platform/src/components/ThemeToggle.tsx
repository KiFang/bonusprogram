"use client";

export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const explicit = root.dataset.theme;
    const dark = explicit ? explicit === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // приватный режим: тема просто не запомнится
    }
  }
  return (
    <button type="button" className="btn btn-small btn-ghost theme-btn" onClick={toggle} aria-label="Сменить тему">
      <span className="to-dark">Тёмная</span>
      <span className="to-light">Светлая</span>
    </button>
  );
}
