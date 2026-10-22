#!/usr/bin/env bash
# Выкладка на сервер. Запускать из каталога platform: ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Нет файла .env. Скопируйте .env.example в .env и заполните." >&2
  exit 1
fi
set -a; . ./.env; set +a
[ "${#SESSION_SECRET}" -ge 32 ] || { echo "SESSION_SECRET должен быть не короче 32 символов (openssl rand -hex 32)." >&2; exit 1; }
[ "${POSTGRES_PASSWORD:-change-me}" != "change-me" ] || { echo "Задайте свой POSTGRES_PASSWORD в .env." >&2; exit 1; }
[ "${SITE_URL#https://}" != "$SITE_URL" ] || echo "Внимание: SITE_URL без https, cookie входа не будут помечены Secure."

docker compose up -d --build
echo "Жду, пока приложение станет здоровым..."
for i in $(seq 1 40); do
  state="$(docker compose ps --format '{{.Service}} {{.Health}}' app | awk '{print $2}')"
  [ "$state" = "healthy" ] && { echo "Готово: $SITE_URL"; exit 0; }
  sleep 3
done
echo "Приложение не стало здоровым. Логи: docker compose logs --tail 100 app" >&2
exit 1
