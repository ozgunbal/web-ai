import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @mlc-ai/web-llm ships as ESM with web workers/WASM; no extra Vite config is
// required beyond the default (confirmed against WebLLM's own Vite example apps).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
  optimizeDeps: {
    exclude: ["@mlc-ai/web-llm"],
  },
});
