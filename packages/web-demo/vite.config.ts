import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const EVIDENCE_DIR = resolve(__dirname, "../../evidence");

/**
 * Dev-only sink for evidence records: `POST /__evidence?stream=<name>` appends
 * the JSON body as one line to `<repo>/evidence/<name>.jsonl`. Lets the
 * browser (eval page and live app) persist every model/prompt failure to the
 * repo instead of leaving it in DevTools. Not part of a production build.
 */
function evidenceSink(): Plugin {
  return {
    name: "evidence-sink",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__evidence", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const stream = new URL(req.url ?? "", "http://x").searchParams.get("stream") ?? "misc";
        if (!/^[a-z0-9-]+$/.test(stream)) {
          res.statusCode = 400;
          res.end("bad stream name");
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const line = JSON.stringify(JSON.parse(body));
            mkdirSync(EVIDENCE_DIR, { recursive: true });
            appendFileSync(resolve(EVIDENCE_DIR, `${stream}.jsonl`), `${line}\n`);
            res.statusCode = 204;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

// @mlc-ai/web-llm ships as ESM with web workers/WASM; no extra Vite config is
// required beyond the default (confirmed against WebLLM's own Vite example apps).
export default defineConfig({
  plugins: [react(), evidenceSink()],
  test: {
    environment: "jsdom",
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        eval: resolve(__dirname, "eval.html"),
      },
    },
  },
  optimizeDeps: {
    exclude: ["@mlc-ai/web-llm"],
  },
});
