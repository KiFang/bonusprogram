import Link from "next/link";

export default function NotFound() {
  return (
    <section className="hero">
      <span className="eyebrow">404</span>
      <h1>Здесь пока пусто</h1>
      <p className="lead">Такой страницы нет, или она ещё в наброске.</p>
      <div className="cta"><Link className="btn" href="/">На главную</Link></div>
    </section>
  );
}
