#!/usr/bin/env node
/**
 * Runs the web intent-parser evaluation unattended in a real, HEADED Chrome
 * (headless Chrome has no WebGPU adapter; headed Chrome driven over the
 * DevTools protocol does). Results land in evidence/eval.jsonl and
 * evidence/eval-models.jsonl via the Vite dev server's evidence sink.
 *
 *   node scripts/run-eval.mjs [--models a,b] [--variants v1_examples] [--split dev|test|all] [--cases v-accounts-1,x-1]
 *
 * Chrome uses its own profile in .cache/eval-chrome, so downloaded models
 * stay cached between runs and the user's normal profile is untouched.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DEV_URL = "http://localhost:5173";
const CDP_PORT = 9333;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split("--")
    .filter(Boolean)
    .map((pair) => pair.trim().split(/\s+/)),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isUp(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(url, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await isUp(url))) {
    if (Date.now() > deadline) throw new Error(`${label} did not come up at ${url}`);
    await sleep(500);
  }
}

if (!(await isUp(DEV_URL))) {
  console.log("Starting web-demo dev server…");
  spawn("pnpm", ["--filter", "@web-ai-trials/web-demo", "dev", "--port", "5173", "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
    detached: true,
  }).unref();
  await waitFor(DEV_URL, "dev server");
}

if (!(await isUp(`http://localhost:${CDP_PORT}/json/version`))) {
  console.log("Launching headed Chrome…");
  const profile = resolve(ROOT, ".cache/eval-chrome");
  mkdirSync(profile, { recursive: true });
  spawn(
    CHROME,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      // Keep inference running at full speed when the window is behind others.
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "about:blank",
    ],
    { stdio: "ignore", detached: true },
  ).unref();
  await waitFor(`http://localhost:${CDP_PORT}/json/version`, "Chrome DevTools endpoint");
}

const query = new URLSearchParams({ autostart: "1", runId: `web-${new Date().toISOString().replace(/[:.]/g, "-")}` });
for (const key of ["models", "variants", "cases", "split"]) if (args[key]) query.set(key, args[key]);
const target = await (
  await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(`${DEV_URL}/eval.html?${query}`)}`, {
    method: "PUT",
  })
).json();

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
};
const evaluate = (expression) =>
  new Promise((r) => {
    const id = nextId++;
    pending.set(id, (msg) => r(msg.result?.result?.value));
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });

console.log(`Eval page open: ${DEV_URL}/eval.html?${query}`);
let lastLine = "";
for (;;) {
  await sleep(5000);
  const status = await evaluate("window.__evalStatus");
  if (!status) continue;
  const line = `[${status.done}/${status.total}] ${status.current}`;
  if (line !== lastLine) console.log(line);
  lastLine = line;
  if (status.state === "done") {
    if (status.errors.length) console.log("Errors:\n  " + status.errors.join("\n  "));
    console.log(`Done. runId=${status.runId}`);
    break;
  }
}
ws.close();
// Close the tab so a later dev-server reload can't touch it.
await fetch(`http://localhost:${CDP_PORT}/json/close/${target.id}`).catch(() => undefined);
process.exit(0);
