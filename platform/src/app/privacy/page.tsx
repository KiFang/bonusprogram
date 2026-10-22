import type { Metadata } from "next";
import { ru } from "@/lib/ru.ts";

export const metadata: Metadata = { title: ru.legal.privacy };

export default function Page() {
  return (
    <section className="prose">
      <h1>{ru.legal.privacy}</h1>
      <p className="notice info">{ru.legal.draft}</p>
    </section>
  );
}
