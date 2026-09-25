import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE — путь сайта: "/" для своего домена, "/bonusprogram/" для GitHub Pages.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
});
