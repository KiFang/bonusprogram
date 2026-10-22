import Link from "next/link";
import { ru } from "@/lib/ru.ts";
import { currentUser } from "@/lib/session.ts";

export default async function Home() {
  const user = await currentUser();
  return (
    <>
      <section className="hero">
        <span className="eyebrow">{ru.home.eyebrow}</span>
        <h1>{ru.home.title}</h1>
        <p className="lead">{ru.home.lead}</p>
        <div className="cta">
          <Link className="btn btn-primary" href={user ? "/me" : "/login"}>{user ? ru.nav.profile : ru.home.cta}</Link>
        </div>
      </section>
      <section className="points" aria-label="Что внутри">
        {ru.home.points.map(([title, text]) => (
          <article className="card" key={title}>
            <h3>{title}</h3>
            <p className="soft">{text}</p>
          </article>
        ))}
      </section>
      <p className="notice info">{ru.home.note}</p>
    </>
  );
}
