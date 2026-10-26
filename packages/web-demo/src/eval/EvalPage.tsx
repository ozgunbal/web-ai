import { useEffect, useRef, useState } from "react";
import {
  EVAL_CASES,
  PROMPT_VARIANTS,
  runEvalCase,
  WebLlmEngineClient,
  type EvalRecord,
} from "@web-ai-trials/core/web";

/**
 * Benchmark page (eval.html). Runs every model x prompt variant x labeled
 * case through the real parseIntent + WebLLM path and POSTs each scored
 * record to the dev server's evidence sink (see vite.config.ts), which writes
 * evidence/eval.jsonl. Driven by query params so scripts/run-eval.mjs can run
 * it unattended:
 *
 *   /eval.html?models=a,b&variants=v1_examples&cases=v-accounts-1&autostart=1
 *
 * Progress is mirrored on `window.__evalStatus` for the runner to poll.
 */

export const DEFAULT_MODELS = [
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
  "gemma3-1b-it-q4f16_1-MLC",
  "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "gemma-2-2b-it-q4f16_1-MLC",
  "Phi-3.5-mini-instruct-q4f16_1-MLC",
];

interface EvalStatus {
  state: "idle" | "running" | "done";
  runId: string;
  done: number;
  total: number;
  current: string;
  errors: string[];
}

declare global {
  interface Window {
    __evalStatus?: EvalStatus;
  }
}

async function postEvidence(stream: string, record: unknown): Promise<void> {
  await fetch(`/__evidence?stream=${stream}`, { method: "POST", body: JSON.stringify(record) });
}

async function gpuInfo(): Promise<unknown> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu;
  const adapter = await gpu?.requestAdapter();
  return adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture } : null;
}

function listParam(params: URLSearchParams, key: string): string[] | null {
  const value = params.get(key);
  return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : null;
}

export function EvalPage() {
  const params = new URLSearchParams(window.location.search);
  const models = listParam(params, "models") ?? DEFAULT_MODELS;
  const variantIds = listParam(params, "variants");
  const caseIds = listParam(params, "cases");
  const variants = variantIds ? PROMPT_VARIANTS.filter((v) => variantIds.includes(v.id)) : PROMPT_VARIANTS;
  const cases = caseIds ? EVAL_CASES.filter((c) => caseIds.includes(c.id)) : EVAL_CASES;
  const total = models.length * variants.length * cases.length;

  const [status, setStatus] = useState<EvalStatus>({ state: "idle", runId: "", done: 0, total, current: "", errors: [] });
  const [records, setRecords] = useState<EvalRecord[]>([]);
  const started = useRef(false);

  const update = (patch: Partial<EvalStatus>) =>
    setStatus((prev) => {
      const next = { ...prev, ...patch };
      window.__evalStatus = next;
      return next;
    });

  async function run() {
    if (started.current) return;
    started.current = true;
    const runId = params.get("runId") ?? `web-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const errors: string[] = [];
    let done = 0;
    update({ state: "running", runId, done, errors });
    const gpu = await gpuInfo();

    for (const modelId of models) {
      const engine = new WebLlmEngineClient(modelId);
      engine.setProgressCallback((p) => update({ current: `${modelId}: ${p.text}` }));
      let warmupMs: number | null = null;
      let loadError: string | null = null;
      try {
        await engine.preload();
        // First completion compiles shaders; time it separately so it doesn't skew per-case latency.
        const warmStart = Date.now();
        await engine.complete({ system: "Reply with {}", user: "hi" });
        warmupMs = Date.now() - warmStart;
      } catch (err) {
        loadError = err instanceof Error ? err.message : String(err);
        errors.push(`${modelId}: ${loadError}`);
      }
      await postEvidence("eval-models", {
        runId,
        timestamp: new Date().toISOString(),
        platform: "web",
        engine: "webllm",
        modelId,
        loadMs: engine.loadTimeMs,
        warmupMs,
        loadError,
        gpu,
        userAgent: navigator.userAgent,
      });
      if (loadError) {
        done += variants.length * cases.length;
        update({ done, errors: [...errors] });
        continue;
      }

      for (const variant of variants) {
        for (const evalCase of cases) {
          update({ current: `${modelId} · ${variant.id} · ${evalCase.id}` });
          const record = await runEvalCase(engine, evalCase, variant, {
            runId,
            platform: "web",
            engine: "webllm",
            modelId,
            modelLoadMs: engine.loadTimeMs,
            readUsage: () => engine.lastUsage,
          });
          await postEvidence("eval", record);
          done += 1;
          setRecords((prev) => [record, ...prev].slice(0, 200));
          update({ done });
        }
      }
      await engine.unload();
    }
    update({ state: "done", current: "" });
  }

  useEffect(() => {
    window.__evalStatus = status;
    if (params.get("autostart") === "1") void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="eval-page">
      <h1>Intent parser evaluation</h1>
      <p>
        {models.length} models × {variants.length} prompt variants × {cases.length} cases = {total} runs. Results are
        appended to <code>evidence/eval.jsonl</code>.
      </p>
      <button onClick={() => void run()} disabled={status.state !== "idle"}>
        {status.state === "idle" ? "Start" : status.state === "running" ? "Running…" : "Done"}
      </button>
      <p>
        {status.done}/{status.total} {status.current && <span>— {status.current}</span>}
      </p>
      {status.errors.length > 0 && (
        <ul className="eval-errors">
          {status.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <table className="eval-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Prompt</th>
            <th>Case</th>
            <th>Verdict</th>
            <th>ms</th>
            <th>Raw (last attempt)</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={`${r.modelId}-${r.promptVariant}-${r.caseId}`} className={r.pass ? "pass" : "fail"}>
              <td>{r.modelId.replace("-q4f16_1-MLC", "")}</td>
              <td>{r.promptVariant}</td>
              <td>{r.caseId}</td>
              <td>{r.verdict}</td>
              <td>{r.totalLatencyMs}</td>
              <td>
                <code>{r.attempts.at(-1)?.raw.slice(0, 160) ?? r.error}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
