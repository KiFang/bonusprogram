import { pool } from "./db.ts";

/**
 * Счётчик по фиксированным окнам. Возвращает true, если лимит ещё не превышен.
 * Ключ строится из назначения и адреса или почты, например "login:ip:1.2.3.4".
 */
export async function allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { rows } = await pool().query<{ count: number }>(
    `insert into rate_limits (key, window_start, count)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1
     returning count`,
    [key, windowSeconds],
  );
  if (Math.random() < 0.01) {
    await pool().query("delete from rate_limits where window_start < now() - interval '2 days'").catch(() => {});
  }
  return rows[0].count <= limit;
}
