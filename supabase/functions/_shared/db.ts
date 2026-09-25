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

// ---- файлы коллекции (приватный бакет art) ----

export const ART_BUCKET = "art";

/** Подписанные ссылки на картинки: действуют час, бакет закрыт. */
export async function signArt<T extends { path: string }>(items: T[]): Promise<(T & { url: string | null })[]> {
  if (!items.length) return [];
  const { data } = await db.storage.from(ART_BUCKET).createSignedUrls(items.map((i) => i.path), 3600);
  const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return items.map((i) => ({ ...i, url: urls.get(i.path) ?? null }));
}

export async function artistIdByUser(userId: string): Promise<string | null> {
  const { data, error } = await db.from("artists").select("id").eq("user_id", userId).eq("active", true).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}
