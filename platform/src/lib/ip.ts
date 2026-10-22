import { trustProxy } from "./env.ts";

/** Адрес клиента. X-Forwarded-For берём, только если за нами стоит свой прокси (TRUST_PROXY=1). */
export function clientIp(h: Headers): string {
  if (trustProxy()) {
    const xff = h.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0].trim();
      if (first) return first;
    }
    const real = h.get("x-real-ip");
    if (real) return real.trim();
  }
  return "unknown";
}
