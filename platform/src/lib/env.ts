// Чтение настроек окружения. В продакшене обязательные значения проверяются при первом обращении.

const DEV_SECRET = "dev-only-secret-do-not-use-in-production-0000";
const isProd = () => process.env.NODE_ENV === "production";

export function sessionSecret(): string {
  const v = process.env.SESSION_SECRET ?? "";
  if (v.length >= 32) return v;
  if (isProd()) throw new Error("SESSION_SECRET не задан или короче 32 символов");
  return DEV_SECRET;
}

export function databaseUrl(): string {
  const v = process.env.DATABASE_URL;
  if (!v) throw new Error("DATABASE_URL не задан");
  return v;
}

export function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function cookiesSecure(): boolean {
  return siteUrl().startsWith("https://");
}

export function trustProxy(): boolean {
  return process.env.TRUST_PROXY === "1";
}

export function smtpConfig() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? 465),
    user: process.env.SMTP_USER ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.MAIL_FROM ?? "ARTCHIEVE SERVICE <no-reply@localhost>",
  };
}
