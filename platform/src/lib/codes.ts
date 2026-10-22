// Одноразовые коды входа. В базе хранится только хэш; он привязан к адресу почты и секрету сервера.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;

export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

export function hashCode(email: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`login:${email}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

/** Токен сессии: сам токен только в cookie, в базе его sha256. */
export function newSessionToken(): { token: string; id: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, id: sessionIdOf(token) };
}

export function sessionIdOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
