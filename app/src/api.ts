import { useCallback, useEffect, useState } from "react";
import { tg } from "./tg";

const API_URL = import.meta.env.VITE_API_URL as string;
const KEY = (import.meta.env.VITE_SUPABASE_KEY as string) ?? "";

export async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-telegram-init-data": tg?.initData ?? "",
  };
  if (KEY) headers.apikey = KEY;
  let res: Response;
  try {
    res = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify({ action, params }) });
  } catch {
    throw new Error("Нет связи с сервером. Проверьте интернет.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Что-то пошло не так");
  return body.data as T;
}

/** Загрузка картинки к заказу (multipart). */
export async function uploadArt(orderId: string, file: Blob, nsfw: boolean): Promise<GalleryItem> {
  const form = new FormData();
  form.append("order_id", orderId);
  form.append("nsfw", String(nsfw));
  form.append("file", file, "art.jpg");
  const headers: Record<string, string> = { "x-telegram-init-data": tg?.initData ?? "" };
  if (KEY) headers.apikey = KEY;
  let res: Response;
  try {
    res = await fetch(API_URL, { method: "POST", headers, body: form });
  } catch {
    throw new Error("Нет связи с сервером. Проверьте интернет.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Не удалось загрузить картинку");
  return body.data as GalleryItem;
}

export function useLoad<T>(action: string, params: Record<string, unknown> = {}, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(params);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await call<T>(action, JSON.parse(key)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, key, ...deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

// ---- типы ответов ----

export type Artist = {
  is_group_admin?: boolean;
  slots_mode?: "open" | "rest" | "unlimited";
  id: string;
  nick: string;
  display_name: string;
  bio: string;
  color: string;
  foreign_mode: "unlimited" | "by_tier";
  points_ttl_days: number | null;
  program_id: string;
};

export type Program = { id: string; name: string; type: "group" | "solo"; slug: string; artists: Artist[] };

export type TierInfo = {
  index: number;
  count: number;
  name: string;
  earn_pct: number;
  pay_pct: number;
  foreign_pct: number;
  perks: string;
  spent: number;
  progress: number;
  next: { name: string; min_spent: number } | null;
};

export type Fundraiser = { id: string; title: string; goal: number; raised: number; count: number; status: string };
export type WalletProgram = Program & { balance: number; tiers: Record<string, TierInfo>; fundraiser: Fundraiser | null };

export type Me = {
  user: {
    id: string; name: string; username: string | null; code: string;
    birth_day: number | null; birth_month: number | null; has_referrer: boolean;
  };
  onboarded: { member: boolean; artist: boolean };
  artist: (Artist & { program: Program }) | null;
  programs: WalletProgram[];
};

export type Entry = {
  id: string;
  kind: "accrual" | "redeem" | "bonus" | "donation" | "gift" | "referral" | "birthday" | "forfeit";
  order_amount: number;
  paid_amount: number;
  earned: number;
  redeemed: number;
  points: number;
  tier: { name: string; earn_pct: number; pay_pct: number } | null;
  source: string;
  created_at: string;
  reversed: boolean;
  artist_nick: string | null;
};

export type Tier = {
  early_hours?: number;
  name: string;
  min_spent: number;
  earn_pct: number;
  pay_pct: number;
  foreign_pct: number;
  perks: string;
};

export type Quote = {
  mode: "earn" | "redeem";
  amount: number;
  redeem: number;
  max_redeem: number;
  pay_limit: number;
  foreign_cap: number | null;
  foreign_available: number;
  own_available: number;
  paid: number;
  earn: number;
  points: number;
  balance_before: number;
  balance_after: number;
  spent_after: number;
  tier: { index: number; name: string; earn_pct: number; pay_pct: number; foreign_pct: number };
  new_tier: { index: number; name: string };
  tier_up: boolean;
  member: { name: string; code: string };
  program: { name: string; type: "group" | "solo" };
  gift_used?: number;
  gift_available?: number;
  multiplier?: number;
  promotion?: Promotion | null;
  birthday_boost?: number;
  order: { id: string; title: string } | null;
  orders?: { id: string; title: string; price: number | null; stage_name: string }[];
  entry_id?: string;
};

export type Order = {
  id: string;
  title: string;
  price: number | null;
  stages: string[];
  stage: number;
  stage_name: string;
  status: "active" | "done" | "cancelled";
  created_at: string;
  updated_at: string;
  done_at: string | null;
  paid: number;
  redeemed: number;
  artist: { id: string; nick: string; color: string; display_name: string };
  member: { name: string; code: string };
};

export type GalleryItem = {
  id: string;
  path: string;
  url: string | null;
  nsfw: boolean;
  hidden: boolean;
  created_at: string;
  order_id: string | null;
  order_title: string | null;
  artist: { id: string; nick: string; color: string; display_name: string };
};

export type Slots = {
  mode: "open" | "rest" | "unlimited";
  total: number;
  taken: number;
  free: number | null;
  opened_at: string | null;
  access_at: string | null;
  early_hours: number;
  pending_request: string | null;
  can_request: boolean;
};

export type Promotion = { id: string; title: string; multiplier: number; starts_at: string; ends_at: string; active?: boolean };

export type Certificate = {
  id: string; code: string; amount: number; status: "issued" | "activated" | "void"; note: string;
  scope: "artist" | "group"; paid_via: "artist" | "stars"; expires_at: string; created_at: string;
  activated_at: string | null; activated_by: string | null;
  program: { id: string; name: string; type: "group" | "solo" }; artist: { id: string; nick: string } | null;
};

export type OrderDetail = Order & {
  gallery: GalleryItem[];
  is_artist: boolean;
  events: { kind: string; stage: number; stage_name: string; created_at: string }[];
  payments: Entry[];
};
