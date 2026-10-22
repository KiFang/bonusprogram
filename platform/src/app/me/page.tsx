import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ageStatus } from "@/lib/age.ts";
import { siteUrl } from "@/lib/env.ts";
import { ru } from "@/lib/ru.ts";
import { currentUser } from "@/lib/session.ts";

export const metadata: Metadata = { title: ru.me.title, robots: { index: false } };

export default async function MePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const minor = ageStatus(user.birthDate) === "minor";
  return (
    <section className="stack">
      <h1>{ru.me.title}</h1>
      <div className="card">
        <dl className="facts">
          <dt>{user.displayName}</dt>
          <dd>@{user.nick}</dd>
          <dt>{ru.me.email}</dt>
          <dd>{user.email}</dd>
          <dt>{ru.me.page}</dt>
          <dd>{siteUrl()}/@{user.nick} <span className="muted">(появится позже)</span></dd>
          <dt>{ru.me.status}</dt>
          <dd>{minor ? ru.me.minor : ru.me.adult}</dd>
        </dl>
      </div>
      {minor && <p className="notice info">{ru.register.minorNote}</p>}
    </section>
  );
}
