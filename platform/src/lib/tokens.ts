// Короткоживущие подписанные токены (например, «почта подтверждена, осталось закончить регистрацию»).
import { createHmac, timingSafeEqual } from "node:crypto";

function b64(s: string) {
  return Buffer.from(s).toString("base64url");
}

export function signToken(payload: Record<string, unknown>, secret: string, ttlSeconds: number, nowMs = Date.now()): string {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(nowMs / 1000) + ttlSeconds }));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string, secret: string, nowMs = Date.now()): (T & { exp: number }) | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const good = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(good);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp < Math.floor(nowMs / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}
