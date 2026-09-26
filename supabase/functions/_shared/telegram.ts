// Работа с Telegram: проверка initData Mini App, вызовы Bot API, подпись inline-кнопок.

export type TgUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

/** Оплата звёздами выключена: вывести звёзды в рубли художникам из РФ сложно. */
export const STARS_ENABLED = false;

const enc = new TextEncoder();

async function hmac(key: Uint8Array<ArrayBuffer>, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

function hex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Проверяет подпись initData по алгоритму Telegram:
 * secret = HMAC_SHA256("WebAppData", bot_token), hash = HMAC_SHA256(secret, data_check_string).
 */
export async function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 24 * 3600,
  now = Date.now(),
): Promise<{ user: TgUser; startParam?: string } | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  if (!safeEqual(hex(await hmac(secret, checkString)), hash)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null;

  let user: TgUser | null = null;
  try {
    user = JSON.parse(params.get("user") ?? "null");
  } catch {
    return null;
  }
  if (!user?.id) return null;
  return { user, startParam: params.get("start_param") ?? undefined };
}

// ---- inline-начисление: данные кнопки «Забрать АРТы» ----
// Формат callback_data: c.<tg id художника>.<сумма>.<время>.<подпись>, всё в base36.
// Подпись не даёт подделать сумму или художника. Лимит Telegram — 64 байта.

const CLAIM_TTL_SEC = 48 * 3600;

async function claimSig(secret: string, payload: string): Promise<string> {
  return b64url(await hmac(enc.encode("artoki-claim:" + secret), payload)).slice(0, 16);
}

export async function signClaim(secret: string, artistTgId: number, amount: number, nowSec = Math.floor(Date.now() / 1000)) {
  const payload = `${artistTgId.toString(36)}.${amount.toString(36)}.${nowSec.toString(36)}`;
  return `c.${payload}.${await claimSig(secret, payload)}`;
}

export type ClaimData = { artistTgId: number; amount: number; issuedAt: number };

export async function verifyClaim(
  secret: string,
  data: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<ClaimData | "expired" | null> {
  const parts = data.split(".");
  if (parts.length !== 5 || parts[0] !== "c") return null;
  const payload = parts.slice(1, 4).join(".");
  if (!safeEqual(await claimSig(secret, payload), parts[4])) return null;
  const [artistTgId, amount, issuedAt] = parts.slice(1, 4).map((p) => parseInt(p, 36));
  if (!Number.isSafeInteger(artistTgId) || !Number.isSafeInteger(amount) || amount <= 0) return null;
  if (nowSec - issuedAt > CLAIM_TTL_SEC) return "expired";
  return { artistTgId, amount, issuedAt };
}

// ---- Bot API ----

export function botApi(token: string) {
  return async function call<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
    return json.result as T;
  };
}
