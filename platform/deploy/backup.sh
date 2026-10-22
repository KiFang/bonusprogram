#!/usr/bin/env bash
# Ночной дамп базы. Хранит 7 последних копий в ./backups. Запускать из каталога platform.
# Пример для cron (каждую ночь в 03:15):  15 3 * * * cd /путь/к/platform && ./deploy/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
umask 077
file="backups/artchieve-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U artchieve --no-owner artchieve | gzip > "$file"
[ -s "$file" ] || { echo "Пустой дамп, что-то пошло не так" >&2; rm -f "$file"; exit 1; }
ls -1t backups/artchieve-*.sql.gz | tail -n +8 | xargs -r rm --
echo "$(date -Is) создан $file ($(du -h "$file" | cut -f1))"
