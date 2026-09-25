import { createClient } from "npm:@supabase/supabase-js@2";
import type { TgUser } from "./telegram.ts";

export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Ошибка, текст которой можно показать пользователю. */
export class AppError extends Error {}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new AppError(error.message);
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

export type DbUser = { id: string; telegram_id: number; first_name: string; username: string | null; member_code: string };

export function upsertUser(u: TgUser): Promise<DbUser> {
  return rpc<DbUser>("upsert_user", {
    p_telegram_id: u.id,
    p_username: u.username ?? null,
    p_first_name: u.first_name ?? "",
    p_last_name: u.last_name ?? null,
  });
}

export async function artistByTelegramId(tgId: number): Promise<{ id: string; nick: string; program_id: string } | null> {
  const { data, error } = await db
    .from("artists")
    .select("id, nick, program_id, users!inner(telegram_id)")
    .eq("users.telegram_id", tgId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: data.id, nick: data.nick, program_id: data.program_id } : null;
}
