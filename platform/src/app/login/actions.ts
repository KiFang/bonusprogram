"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ageStatus } from "@/lib/age.ts";
import { CODE_MAX_ATTEMPTS, CODE_TTL_MINUTES, generateCode, hashCode, normalizeCode, safeEqualHex } from "@/lib/codes.ts";
import { isUniqueViolation, pool, tx } from "@/lib/db.ts";
import { sessionSecret } from "@/lib/env.ts";
import { clientIp } from "@/lib/ip.ts";
import { loginCodeMail, sendMail } from "@/lib/mail.ts";
import { allow } from "@/lib/ratelimit.ts";
import { ru } from "@/lib/ru.ts";
import { endSession, REG_COOKIE, startSession } from "@/lib/session.ts";
import { signToken, verifyToken } from "@/lib/tokens.ts";
import { checkDisplayName, checkNick, normalizeEmail } from "@/lib/validate.ts";
import { cookiesSecure } from "@/lib/env.ts";

export type LoginState = { step: "email" | "code"; email?: string; error?: string };
export type RegisterValues = { nick: string; display_name: string; birth_date: string; consent: boolean };
export type RegisterState = { error?: string; values?: RegisterValues };

const HOUR = 3600;

export async function requestCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = normalizeEmail(form.get("email"));
  if (!email.ok) return { step: "email", error: email.error };

  const ip = clientIp(await headers());
  if (!(await allow(`login:email:${email.value}`, 5, HOUR)) || !(await allow(`login:ip:${ip}`, 20, HOUR))) {
    return { step: "email", email: email.value, error: ru.login.errors.tooMany };
  }

  const code = generateCode();
  await tx(async (c) => {
    await c.query("update login_codes set used_at = now() where email = $1 and used_at is null", [email.value]);
    await c.query(
      "insert into login_codes (email, code_hash, expires_at) values ($1, $2, now() + make_interval(mins => $3))",
      [email.value, hashCode(email.value, code, sessionSecret()), CODE_TTL_MINUTES],
    );
  });

  try {
    const mail = loginCodeMail(code, CODE_TTL_MINUTES);
    await sendMail(email.value, mail.subject, mail.text);
  } catch (e) {
    console.error("не удалось отправить код входа", (e as Error).message);
    return { step: "email", email: email.value, error: ru.login.errors.sendFailed };
  }
  // Ответ одинаков для существующих и новых адресов: по нему нельзя узнать, есть ли аккаунт.
  return { step: "code", email: email.value };
}

export async function verifyCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = normalizeEmail(form.get("email"));
  if (!email.ok) return { step: "email", error: email.error };
  const code = normalizeCode(String(form.get("code") ?? ""));

  const ip = clientIp(await headers());
  if (!(await allow(`verify:email:${email.value}`, 10, HOUR)) || !(await allow(`verify:ip:${ip}`, 30, HOUR))) {
    return { step: "code", email: email.value, error: ru.login.errors.tooMany };
  }

  const result = await tx(async (c) => {
    const { rows } = await c.query(
      `select id, code_hash, attempts from login_codes
        where email = $1 and used_at is null and expires_at > now()
        order by created_at desc limit 1 for update`,
      [email.value],
    );
    const row = rows[0];
    if (!row) return "bad" as const;
    if (row.attempts >= CODE_MAX_ATTEMPTS) {
      await c.query("update login_codes set used_at = now() where id = $1", [row.id]);
      return "bad" as const;
    }
    await c.query("update login_codes set attempts = attempts + 1 where id = $1", [row.id]);
    if (code.length !== 6 || !safeEqualHex(row.code_hash, hashCode(email.value, code, sessionSecret()))) return "bad" as const;
    await c.query("update login_codes set used_at = now() where id = $1", [row.id]);
    return "ok" as const;
  });
  if (result === "bad") return { step: "code", email: email.value, error: ru.login.errors.badCode };

  const { rows } = await pool().query(
    `select u.id, u.status from auth_identities i join users u on u.id = i.user_id
      where i.provider = 'email' and i.external_id = $1`,
    [email.value],
  );
  if (rows[0]) {
    if (rows[0].status !== "active") return { step: "email", error: ru.login.errors.blocked };
    await startSession(rows[0].id);
    redirect("/me");
  }

  // Новая почта: подтверждение действует 15 минут, пока человек заполняет анкету.
  (await cookies()).set(REG_COOKIE, signToken({ email: email.value }, sessionSecret(), 15 * 60), {
    httpOnly: true,
    secure: cookiesSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });
  redirect("/register");
}

export async function completeRegistration(_prev: RegisterState, form: FormData): Promise<RegisterState> {
  const jar = await cookies();
  const token = jar.get(REG_COOKIE)?.value;
  const verified = token ? verifyToken<{ email: string }>(token, sessionSecret()) : null;
  if (!verified) return { error: ru.register.expired };

  // React очищает форму после отправки, поэтому при ошибке возвращаем введённое, чтобы поля не пустели.
  const values: RegisterValues = {
    nick: String(form.get("nick") ?? ""),
    display_name: String(form.get("display_name") ?? ""),
    birth_date: String(form.get("birth_date") ?? ""),
    consent: form.get("consent") === "on",
  };
  const nick = checkNick(values.nick);
  if (!nick.ok) return { error: nick.error, values };
  const name = checkDisplayName(values.display_name);
  if (!name.ok) return { error: name.error, values };
  if (!values.consent) return { error: ru.register.mustConsent, values };

  const birth = values.birth_date;
  const age = ageStatus(birth);
  if (age === "invalid" || age === "future") return { error: ru.register.badBirth, values };
  // Ничего не сохраняем. Cookie подтверждения не трогаем: если стереть её здесь, страница перезагрузится,
  // перенаправит на вход, и человек не увидит причину отказа.
  if (age === "too_young") return { error: ru.register.tooYoung, values };

  let userId: string;
  try {
    userId = await tx(async (c) => {
      const { rows } = await c.query(
        `insert into users (email, nick, display_name, birth_date, consent_at)
         values ($1, $2, $3, $4, now()) returning id`,
        [verified.email, nick.value, name.value, birth],
      );
      await c.query("insert into auth_identities (user_id, provider, external_id) values ($1, 'email', $2)", [rows[0].id, verified.email]);
      return rows[0].id as string;
    });
  } catch (e) {
    if (isUniqueViolation(e, "users_nick_key")) return { error: ru.register.nickTaken, values };
    if (isUniqueViolation(e)) {
      // Почта уже занята: аккаунт создан параллельно, просто входим.
      jar.delete(REG_COOKIE);
      redirect("/login");
    }
    throw e;
  }

  jar.delete(REG_COOKIE);
  await startSession(userId);
  redirect("/me");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/");
}
