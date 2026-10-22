import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { todayMsk } from "@/lib/age.ts";
import { sessionSecret } from "@/lib/env.ts";
import { ru } from "@/lib/ru.ts";
import { currentUser, REG_COOKIE } from "@/lib/session.ts";
import { verifyToken } from "@/lib/tokens.ts";
import { RegisterForm } from "@/components/RegisterForm";

export const metadata: Metadata = { title: ru.register.title };

export default async function RegisterPage() {
  if (await currentUser()) redirect("/me");
  const token = (await cookies()).get(REG_COOKIE)?.value;
  const verified = token ? verifyToken<{ email: string }>(token, sessionSecret()) : null;
  if (!verified) redirect("/login");
  return (
    <section className="stack">
      <h1>{ru.register.title}</h1>
      <p className="soft">{ru.register.lead}</p>
      <RegisterForm email={verified.email} today={todayMsk()} />
    </section>
  );
}
