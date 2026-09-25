# Артоки

Бонусная программа для художников: Telegram-бот + Mini App. Клиенты копят и тратят **АРТы** (1 АРТ = 1 ₽ = 0,5 ★), у каждого художника свои уровни лояльности, группы художников делят общий кошелёк.

Спецификация и решения: [`docs/SPEC.md`](docs/SPEC.md).

## Состав

| Папка | Что внутри |
|---|---|
| `supabase/migrations` | Схема БД и вся денежная логика в SQL-функциях |
| `supabase/functions/api` | API для Mini App (проверка Telegram initData) |
| `supabase/functions/bot` | Webhook бота: команды, inline-начисление `@бот 3000` |
| `supabase/tests` | Проверки логики начисления и списания |
| `app` | Mini App (React + Vite), публикуется на GitHub Pages |

## Проверки

```bash
supabase/tests/run.sh          # SQL-логика на временном Postgres (нужны бинарники PostgreSQL, не от root)
node --experimental-strip-types --test supabase/functions/_shared/telegram.test.ts
cd app && npm install && npm run build
```

## Запуск

1. **Бот.** В @BotFather: `/newbot`, затем `/setinline` (включить inline-режим, подсказка «сумма заказа»), затем `/newapp` или «Main Mini App» с адресом `https://kifang.github.io/bonusprogram/`.
2. **Supabase.** Применить миграции из `supabase/migrations`, задеплоить функции `api` и `bot` (обе без проверки JWT: авторизация через Telegram).
3. **Секреты функций** (Supabase → Edge Functions → Secrets):
   - `BOT_TOKEN` — токен от BotFather
   - `WEBHOOK_SECRET` — любая длинная случайная строка
   - `APP_URL` — `https://kifang.github.io/bonusprogram/`
   - `ADMIN_TELEGRAM_IDS` — telegram id админов через запятую
   - `BOT_USERNAME` — имя бота без @ (необязательно)
4. **Mini App.** Собирается и публикуется сценарием `.github/workflows/pages.yml` при пуше в `app/`. В Settings → Pages выбрать Source: GitHub Actions; имя бота задать переменной репозитория `BOT_USERNAME` (Settings → Secrets and variables → Actions → Variables).
5. **Webhook.** Открыть `https://<ref>.supabase.co/functions/v1/bot?setup=<WEBHOOK_SECRET>` — бот получит webhook, команды и кнопку меню.

## Как начать работу

- Админ в боте: `/newgroup polnoch Полночь` — создать группу; `/invite polnoch` или `/invite solo` — ссылка-приглашение художнику.
- Художник открывает ссылку, становится участником программы и настраивает уровни в Mini App.
- Клиенты вступают по ссылке `https://t.me/<бот>?startapp=j_<адрес>` (есть на вкладке «Клиенты») или командой `/bonusp <группа или ник>`.
- Начисление: касса в Mini App (код или QR клиента) или прямо в чате с клиентом — `@<бот> 3000`, клиент жмёт «Забрать АРТы».
