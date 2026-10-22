#!/usr/bin/env bash
# Поднимает временный Postgres, применяет миграции и запускает проверки правил базы.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$(mktemp -d)"
PORT="${PGPORT:-54331}"
trap '"$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT

"$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=''" -w start >/dev/null

PSQL=(psql -X -q -h "$DATA" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1)
for f in "$ROOT"/db/migrations/*.sql; do
  "${PSQL[@]}" -f "$f"
done
for t in "$ROOT"/db/tests/*_test.sql; do
  "${PSQL[@]}" -f "$t" 2>&1 | sed "s/^psql:[^ ]* NOTICE:  //"
done
