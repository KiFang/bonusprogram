// Запуск: node --experimental-strip-types --test supabase/functions/_shared/telegram.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { signClaim, validateInitData, verifyClaim } from "./telegram.ts";

const TOKEN = "123456:TEST-TOKEN";
const enc = new TextEncoder();

async function hmacHex(key: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data))), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeInitData(fields: Record<string, string>, token = TOKEN) {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secretHex = await hmacHex(enc.encode("WebAppData"), token);
  const secret = new Uint8Array(secretHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const hash = await hmacHex(secret, check);
  return new URLSearchParams({ ...fields, hash }).toString();
}

const now = 1_790_000_000_000;
const fields = {
  auth_date: String(now / 1000 - 60),
  query_id: "AAE",
  user: JSON.stringify({ id: 42, first_name: "Кира", username: "kira" }),
  start_param: "j_polnoch",
};

test("initData с верной подписью принимается", async () => {
  const r = await validateInitData(await makeInitData(fields), TOKEN, 86400, now);
  assert.equal(r?.user.id, 42);
  assert.equal(r?.startParam, "j_polnoch");
});

test("подделанный initData отклоняется", async () => {
  const data = (await makeInitData(fields)).replace("%D0%9A%D0%B8%D1%80%D0%B0", "Evil");
  assert.equal(await validateInitData(data, TOKEN, 86400, now), null);
});

test("initData другого бота отклоняется", async () => {
  assert.equal(await validateInitData(await makeInitData(fields, "999:OTHER"), TOKEN, 86400, now), null);
});

test("устаревший initData отклоняется", async () => {
  assert.equal(await validateInitData(await makeInitData(fields), TOKEN, 30, now), null);
});

test("кнопка inline-начисления: подпись, лимит 64 байта, срок", async () => {
  const t0 = 1_790_000_000;
  const data = await signClaim("secret", 7_000_000_000, 10_000_000, t0);
  assert.ok(enc.encode(data).length <= 64, `длина ${data.length}`);
  assert.deepEqual(await verifyClaim("secret", data, t0 + 10), { artistTgId: 7_000_000_000, amount: 10_000_000, issuedAt: t0 });
  assert.equal(await verifyClaim("other", data, t0 + 10), null);
  const forged = data.replace(`.${(10_000_000).toString(36)}.`, `.${(99_000_000).toString(36)}.`);
  assert.equal(await verifyClaim("secret", forged, t0 + 10), null);
  assert.equal(await verifyClaim("secret", data, t0 + 49 * 3600), "expired");
});
