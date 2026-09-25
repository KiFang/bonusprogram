import { createContext, useContext } from "react";
import type { Me } from "./api";

export type Route =
  | { name: "wallet" }
  | { name: "code" }
  | { name: "artist"; id: string }
  | { name: "history"; programId: string }
  | { name: "join"; query: string }
  | { name: "invite"; code: string }
  | { name: "cassa"; code?: string; orderId?: string }
  | { name: "orders" }
  | { name: "myorders" }
  | { name: "order"; id: string }
  | { name: "neworder"; code?: string }
  | { name: "ops" }
  | { name: "clients" }
  | { name: "settings" }
  | { name: "collection" }
  | { name: "profile" }
  | { name: "gift"; code: string }
  | { name: "more" }
  | { name: "slots" }
  | { name: "donations" }
  | { name: "promotions" }
  | { name: "certificates" }
  | { name: "program" };

export type Nav = {
  me: Me;
  route: Route;
  push(r: Route): void;
  pop(): void;
  reset(r: Route): void;
  reloadMe(): Promise<void>;
  toast(message: string): void;
};

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error("NavContext missing");
  return n;
}

export const BOT_USERNAME = (import.meta.env.VITE_BOT_USERNAME as string) ?? "";
export const joinLink = (slug: string) => `https://t.me/${BOT_USERNAME}?startapp=j_${slug}`;
