#!/usr/bin/env bash
# Восстановление базы из дампа: ./deploy/restore.sh backups/artchieve-XXXX.sql.gz
# ВНИМАНИЕ: текущая база будет удалена и заменена содержимым дампа.
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?укажите файл дампа}"
[ -f "$file" ] || { echo "Нет файла $file" >&2; exit 1; }
read -r -p "Заменить текущую базу содержимым $file? Напишите yes: " answer
[ "$answer" = "yes" ] || { echo "Отменено"; exit 1; }
docker compose stop app
docker compose exec -T db psql -U artchieve -d postgres -c "drop database if exists artchieve with (force)" -c "create database artchieve"
gunzip -c "$file" | docker compose exec -T db psql -U artchieve -d artchieve -v ON_ERROR_STOP=1 -q
docker compose start app
echo "База восстановлена"
