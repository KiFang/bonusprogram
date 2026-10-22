"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="hero">
      <span className="eyebrow">ошибка</span>
      <h1>Что-то пошло не так</h1>
      <p className="lead">Мы уже знаем об ошибке. Попробуйте ещё раз.</p>
      <div className="cta"><button className="btn" onClick={reset}>Повторить</button></div>
    </section>
  );
}
