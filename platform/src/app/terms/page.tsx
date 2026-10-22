import type { Metadata } from "next";
import { ru } from "@/lib/ru.ts";

export const metadata: Metadata = { title: ru.legal.terms };

export default function Page() {
  return (
    <section className="prose">
      <h1>{ru.legal.terms}</h1>
      <p className="notice info">{ru.legal.draft}</p>
    </section>
  );
}
