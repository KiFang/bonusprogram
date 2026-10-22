import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginFlow } from "@/components/LoginFlow";
import { ru } from "@/lib/ru.ts";
import { currentUser } from "@/lib/session.ts";

export const metadata: Metadata = { title: ru.login.title };

export default async function LoginPage() {
  if (await currentUser()) redirect("/me");
  return (
    <section className="stack">
      <h1>{ru.login.title}</h1>
      <p className="soft">{ru.login.lead}</p>
      <LoginFlow />
    </section>
  );
}
