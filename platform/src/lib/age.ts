// Возраст по дате рождения. Даты передаются строками YYYY-MM-DD, чтобы не зависеть от часового пояса сервера.

export const MIN_AGE = 14;
export const ADULT_AGE = 18;

export function parseDate(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** Сегодняшняя дата в Москве в виде YYYY-MM-DD (сервер может жить в UTC). */
export function todayMsk(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(now);
}

/** Полных лет на дату `on`. Для 29 февраля день рождения в невисокосный год наступает 1 марта. */
export function ageOn(birth: string, on: string): number | null {
  const b = parseDate(birth), t = parseDate(on);
  if (!b || !t) return null;
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age--;
  return age;
}

export type AgeStatus = "invalid" | "future" | "too_young" | "minor" | "adult";

export function ageStatus(birth: string, today: string = todayMsk()): AgeStatus {
  const age = ageOn(birth, today);
  if (age === null) return "invalid";
  if (birth > today) return "future";
  if (age < 0) return "future";
  if (age < MIN_AGE) return "too_young";
  if (age < ADULT_AGE) return "minor";
  return "adult";
}
