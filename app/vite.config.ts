import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE — путь сайта: "/" для своего домена, "/bonusprogram/" для GitHub Pages.
// Режим demo (`vite build --mode demo`) собирает демо без Telegram и сервера в dist/demo.
export default defineConfig(({ mode }) => ({
  base: mode === "demo" ? `${process.env.VITE_BASE ?? "/"}demo/` : process.env.VITE_BASE ?? "/",
  plugins: [react()],
  build: mode === "demo" ? { outDir: "dist/demo" } : {},
}));
