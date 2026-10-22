// Проверка пользовательского ввода. Возвращает значение или текст ошибки для показа человеку.

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NICK_RE = /^[a-z0-9_]{3,24}$/;
const RESERVED_NICKS = new Set([
  "admin", "administrator", "root", "support", "help", "api", "login", "logout", "register", "me", "dev", "static",
  "artchieve", "artist", "artists", "order", "orders", "settings", "terms", "privacy", "healthz", "moderator", "system",
]);

export function normalizeEmail(raw: unknown): Checked<string> {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v.length > 254 || !EMAIL_RE.test(v)) return { ok: false, error: "Проверьте адрес почты" };
  return { ok: true, value: v };
}

export function checkNick(raw: unknown): Checked<string> {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!NICK_RE.test(v)) return { ok: false, error: "Ник: от 3 до 24 символов, латиница, цифры и подчёркивание" };
  if (RESERVED_NICKS.has(v)) return { ok: false, error: "Этот ник занят системой, выберите другой" };
  return { ok: true, value: v };
}

export function checkDisplayName(raw: unknown): Checked<string> {
  const v = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (v.length < 1 || v.length > 60) return { ok: false, error: "Имя: от 1 до 60 символов" };
  if (/[<>]/.test(v)) return { ok: false, error: "В имени нельзя использовать < и >" };
  return { ok: true, value: v };
}
