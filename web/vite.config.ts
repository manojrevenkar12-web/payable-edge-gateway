import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev` with the gateway on :8787 (`npx wrangler dev` in the repo root) lets the console read the live report.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/__admin": "http://127.0.0.1:8787" } },
  test: { environment: "jsdom", include: ["test/**/*.test.tsx"] },
} as never);
