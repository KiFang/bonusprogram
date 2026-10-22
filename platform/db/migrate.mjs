// Применяет SQL-миграции из db/migrations по порядку имён. Уже применённые пропускает.
// Каждая миграция идёт в своей транзакции; параллельный запуск блокируется консультативной блокировкой.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL не задан");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("select pg_advisory_lock(727001)");
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log(`применена ${f}`);
      applied++;
    } catch (e) {
      await client.query("rollback");
      console.error(`ошибка в ${f}: ${e.message}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) console.log(applied ? `готово, применено: ${applied}` : "база актуальна");
} finally {
  await client.end();
}
