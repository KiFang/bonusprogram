import { cache } from "react";
import { cookies } from "next/headers";
import { newSessionToken, sessionIdOf } from "./codes.ts";
import { cookiesSecure } from "./env.ts";
import { pool } from "./db.ts";

export const SESSION_COOKIE = "sid";
export const REG_COOKIE = "reg";
const SESSION_DAYS = 30;

export type CurrentUser = {
  id: string;
  email: string;
  nick: string;
  displayName: string;
  birthDate: string;
  role: "user" | "admin";
};

export async function startSession(userId: string): Promise<void> {
  const { token, id } = newSessionToken();
  await pool().query(
    "insert into sessions (id, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))",
    [id, userId, SESSION_DAYS],
  );
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookiesSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await pool().query("delete from sessions where id = $1", [sessionIdOf(token)]);
  jar.delete(SESSION_COOKIE);
}

export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { rows } = await pool().query(
    `select u.id, u.email, u.nick, u.display_name, to_char(u.birth_date, 'YYYY-MM-DD') as birth_date, u.role
       from sessions s join users u on u.id = s.user_id
      where s.id = $1 and s.expires_at > now() and u.status = 'active'`,
    [sessionIdOf(token)],
  );
  const r = rows[0];
  return r ? { id: r.id, email: r.email, nick: r.nick, displayName: r.display_name, birthDate: r.birth_date, role: r.role } : null;
});
