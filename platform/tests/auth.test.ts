import { strict as assert } from "node:assert";
import { test } from "node:test";
import { generateCode, hashCode, newSessionToken, normalizeCode, safeEqualHex, sessionIdOf } from "../src/lib/codes.ts";
import { signToken, verifyToken } from "../src/lib/tokens.ts";
import { checkDisplayName, checkNick, normalizeEmail } from "../src/lib/validate.ts";

const SECRET = "x".repeat(40);

test("код: 6 цифр, с ведущими нулями", () => {
  for (let i = 0; i < 200; i++) assert.match(generateCode(), /^\d{6}$/);
});

test("хэш кода привязан к почте, коду и секрету", () => {
  const h = hashCode("a@example.ru", "123456", SECRET);
  assert.equal(h, hashCode("a@example.ru", "123456", SECRET));
  assert.notEqual(h, hashCode("b@example.ru", "123456", SECRET));
  assert.notEqual(h, hashCode("a@example.ru", "123457", SECRET));
  assert.notEqual(h, hashCode("a@example.ru", "123456", "y".repeat(40)));
  assert.ok(safeEqualHex(h, h));
  assert.ok(!safeEqualHex(h, hashCode("a@example.ru", "000000", SECRET)));
  assert.ok(!safeEqualHex(h, "zz"));
  assert.ok(!safeEqualHex("", ""));
});

test("ввод кода: пробелы и дефисы убираются, лишнее обрезается", () => {
  assert.equal(normalizeCode("12 34-56"), "123456");
  assert.equal(normalizeCode("1234567"), "123456");
  assert.equal(normalizeCode("abc"), "");
});

test("токен сессии: в базе только sha256", () => {
  const { token, id } = newSessionToken();
  assert.ok(token.length >= 43);
  assert.equal(id, sessionIdOf(token));
  assert.notEqual(id, token);
  assert.notEqual(newSessionToken().token, token);
});

test("подписанный токен: подпись, срок, подмена", () => {
  const now = 1_700_000_000_000;
  const t = signToken({ email: "a@example.ru" }, SECRET, 900, now);
  assert.equal(verifyToken<{ email: string }>(t, SECRET, now + 1000)?.email, "a@example.ru");
  assert.equal(verifyToken(t, SECRET, now + 901_000), null, "после срока не принимается");
  assert.equal(verifyToken(t, "y".repeat(40), now), null, "чужой секрет");
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ email: "evil@example.ru", exp: 9_999_999_999 })).toString("base64url");
  assert.equal(verifyToken(`${forged}.${sig}`, SECRET, now), null, "подмена тела");
  assert.equal(verifyToken(`${body}.${sig}.x`, SECRET, now), null);
  assert.equal(verifyToken("мусор", SECRET, now), null);
});

test("почта приводится к нижнему регистру и проверяется", () => {
  assert.deepEqual(normalizeEmail("  Anna@Example.RU "), { ok: true, value: "anna@example.ru" });
  assert.equal(normalizeEmail("no-at").ok, false);
  assert.equal(normalizeEmail("a@b").ok, false);
  assert.equal(normalizeEmail("a b@c.ru").ok, false);
  assert.equal(normalizeEmail("a".repeat(250) + "@x.ru").ok, false);
});

test("ник: правила и зарезервированные", () => {
  assert.deepEqual(checkNick(" Ink_Fox "), { ok: true, value: "ink_fox" });
  assert.equal(checkNick("ab").ok, false);
  assert.equal(checkNick("a".repeat(25)).ok, false);
  assert.equal(checkNick("ник").ok, false);
  assert.equal(checkNick("with space").ok, false);
  assert.equal(checkNick("admin").ok, false);
  assert.equal(checkNick("Artchieve").ok, false);
});

test("имя: пробелы схлопываются, угловые скобки запрещены", () => {
  assert.deepEqual(checkDisplayName("  Аня   Рисует "), { ok: true, value: "Аня Рисует" });
  assert.equal(checkDisplayName("").ok, false);
  assert.equal(checkDisplayName("x".repeat(61)).ok, false);
  assert.equal(checkDisplayName("<b>Аня</b>").ok, false);
});
