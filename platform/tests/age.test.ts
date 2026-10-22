import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ageOn, ageStatus, parseDate, todayMsk } from "../src/lib/age.ts";

test("возраст: день до и в день рождения", () => {
  assert.equal(ageOn("2010-06-15", "2024-06-14"), 13);
  assert.equal(ageOn("2010-06-15", "2024-06-15"), 14);
  assert.equal(ageOn("2006-06-15", "2024-06-14"), 17);
  assert.equal(ageOn("2006-06-15", "2024-06-15"), 18);
});

test("29 февраля: в невисокосный год день рождения 1 марта", () => {
  assert.equal(ageOn("2008-02-29", "2026-02-28"), 17);
  assert.equal(ageOn("2008-02-29", "2026-03-01"), 18);
});

test("статусы по возрасту", () => {
  const today = "2026-10-22";
  assert.equal(ageStatus("2013-10-23", today), "too_young"); // 12 лет
  assert.equal(ageStatus("2012-10-23", today), "too_young"); // 13 лет, завтра 14
  assert.equal(ageStatus("2012-10-22", today), "minor");     // ровно 14
  assert.equal(ageStatus("2008-10-23", today), "minor");     // 17 лет, завтра 18
  assert.equal(ageStatus("2008-10-22", today), "adult");     // ровно 18
  assert.equal(ageStatus("2027-01-01", today), "future");
  assert.equal(ageStatus("не дата", today), "invalid");
  assert.equal(ageStatus("2026-02-30", today), "invalid");
});

test("разбор даты отклоняет несуществующие даты", () => {
  assert.equal(parseDate("2025-02-29"), null);
  assert.deepEqual(parseDate("2024-02-29"), { y: 2024, m: 2, d: 29 });
  assert.equal(parseDate("2024-2-9"), null);
});

test("сегодня по Москве: полночь UTC уже следующий день", () => {
  assert.equal(todayMsk(new Date("2026-10-22T21:30:00Z")), "2026-10-23");
  assert.equal(todayMsk(new Date("2026-10-22T20:59:00Z")), "2026-10-22");
});
