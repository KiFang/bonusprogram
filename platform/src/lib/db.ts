import pg from "pg";
import { databaseUrl } from "./env.ts";

declare global {
  // eslint-disable-next-line no-var
  var __pool: pg.Pool | undefined;
}

// Часовой пояс соединения совпадает с тем, по которому приложение считает возраст.
export function pool(): pg.Pool {
  if (!globalThis.__pool) {
    globalThis.__pool = new pg.Pool({
      connectionString: databaseUrl(),
      max: 10,
      idleTimeoutMillis: 30_000,
      options: "-c timezone=Europe/Moscow",
    });
  }
  return globalThis.__pool;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && (!constraint || err.constraint === constraint);
}
