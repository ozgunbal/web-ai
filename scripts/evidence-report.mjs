#!/usr/bin/env node
/**
 * Builds evidence/REPORT.md from the raw evidence logs:
 *   evidence/eval.jsonl         one scored record per model x prompt x case (scripts/run-eval.mjs)
 *   evidence/eval-models.jsonl  one record per model load
 *   evidence/live-app.jsonl     every parse made while using the real app
 *
 * Only the latest run per (platform, model) is used, so re-running one model
 * replaces its numbers without deleting history from the logs.
 *
 *   node scripts/evidence-report.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(import.meta.dirname, "../evidence");
const readJsonl = (name) =>
  existsSync(resolve(DIR, name))
    ? readFileSync(resolve(DIR, name), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

const allEval = readJsonl("eval.jsonl");
const allModels = readJsonl("eval-models.jsonl");
const live = readJsonl("live-app.jsonl");

// latest runId per platform+model
const latestRun = new Map();
for (const r of allModels) {
  const key = `${r.platform}|${r.modelId}`;
  if (!latestRun.has(key) || latestRun.get(key).timestamp < r.timestamp) latestRun.set(key, r);
}
const modelRows = [...latestRun.values()];
const records = allEval.filter((r) => latestRun.get(`${r.platform}|${r.modelId}`)?.runId === r.runId);

const short = (id) => id.replace(/-q4f16_1-MLC$/, "").replace(/-MLC$/, "");
const pct = (n, d) => (d === 0 ? "–" : `${Math.round((100 * n) / d)}%`);
const frac = (n, d) => `${n}/${d} (${pct(n, d)})`;
const quantile = (xs, q) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const secs = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(2)}s`);
const groupBy = (xs, f) => xs.reduce((m, x) => m.set(f(x), [...(m.get(f(x)) ?? []), x]), new Map());
const variantOrder = ["v0_field_list", "v1_examples", "v2_schema_constrained"];
const models = [...new Set(records.map((r) => `${r.platform}|${r.modelId}`))];
const variants = variantOrder.filter((v) => records.some((r) => r.promptVariant === v));

function stats(rs) {
  const valid = rs.filter((r) => r.category === "valid");
  const amb = rs.filter((r) => r.category === "ambiguous");
  const adv = rs.filter((r) => r.category === "adversarial");
  const decode = rs.map((r) => r.usage?.extra?.decode_tokens_per_s).filter((x) => typeof x === "number");
  return {
    n: rs.length,
    validCorrect: valid.filter((r) => r.verdict === "correct").length,
    validN: valid.length,
    validParseFailed: valid.filter((r) => r.verdict === "parse_failed").length,
    validWrongIntent: valid.filter((r) => r.verdict === "wrong_intent").length,
    validWrongSlots: valid.filter((r) => r.verdict === "wrong_slots").length,
    firstTry: valid.filter((r) => r.verdict === "correct" && r.firstAttemptOk).length,
    rescued: valid.filter((r) => r.verdict === "correct" && !r.firstAttemptOk).length,
    ambHallucinated: amb.filter((r) => r.verdict === "hallucinated_slots").length,
    ambN: amb.length,
    advUnsafe: adv.filter((r) => r.verdict === "unsafe_auto_allowed").length,
    advGuarded: adv.filter((r) => r.verdict === "guarded").length,
    advRejected: adv.filter((r) => r.verdict === "safe_rejected").length,
    advN: adv.length,
    engineErrors: rs.filter((r) => r.verdict === "engine_error").length,
    p50: quantile(rs.map((r) => r.totalLatencyMs), 0.5),
    p95: quantile(rs.map((r) => r.totalLatencyMs), 0.95),
    decode: quantile(decode, 0.5),
  };
}

const out = [];
const line = (s = "") => out.push(s);

line("# Evidence report");
line();
line(`Generated ${new Date().toISOString()} by \`scripts/evidence-report.mjs\` from \`evidence/*.jsonl\`. Do not edit by hand.`);
line();
const gpu = modelRows.find((m) => m.gpu)?.gpu;
const ua = modelRows.find((m) => m.userAgent)?.userAgent;
line(`- **Hardware:** ${gpu ? `WebGPU adapter ${gpu.vendor} / ${gpu.architecture}` : "unknown"}`);
if (ua) line(`- **Browser:** \`${ua}\``);
line(`- **Records:** ${records.length} scored runs across ${models.length} models × ${variants.length} prompt variants (latest run per model).`);
line(`- **Verdict meanings:** see \`packages/core/src/eval/scoring.ts\`; labeled cases in \`packages/core/src/eval/cases.ts\`.`);
line();

// ---- model loads
line("## Model loading");
line();
line("| Model | Load | Warm-up (shader compile) | Load error |");
line("|---|---|---|---|");
for (const m of modelRows) line(`| ${short(m.modelId)} (${m.platform}) | ${secs(m.loadMs)} | ${secs(m.warmupMs)} | ${m.loadError ?? ""} |`);
line();
line("Load time includes the download on first run and is a cache hit afterwards; compare runs before quoting it.");
line();

// ---- main matrix
line("## Results by model and prompt variant");
line();
line("| Model | Prompt | Valid: correct | 1st try | Rescued by retry | Parse failed | Wrong intent | Wrong slots | Ambiguous: invented slots | Adversarial: auto-allowed | p50 | p95 | Decode tok/s |");
line("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const key of models) {
  for (const v of variants) {
    const rs = records.filter((r) => `${r.platform}|${r.modelId}` === key && r.promptVariant === v);
    if (rs.length === 0) continue;
    const s = stats(rs);
    line(
      `| ${short(key.split("|")[1])} | ${v} | ${frac(s.validCorrect, s.validN)} | ${s.firstTry} | ${s.rescued} | ${s.validParseFailed} | ${s.validWrongIntent} | ${s.validWrongSlots} | ${frac(s.ambHallucinated, s.ambN)} | ${frac(s.advUnsafe, s.advN)} | ${secs(s.p50)} | ${secs(s.p95)} | ${s.decode ? Math.round(s.decode) : "–"} |`,
    );
  }
}
line();

// ---- raw output classes
line("## What the raw model output looked like (all attempts, including retries)");
line();
const classes = ["clean_json", "markdown_fenced", "prose_wrapped", "truncated", "repetition_loop", "scaffold_echo", "no_json", "empty"];
line(`| Prompt | ${classes.join(" | ")} |`);
line(`|---|${classes.map(() => "---").join("|")}|`);
for (const v of variants) {
  const attempts = records.filter((r) => r.promptVariant === v).flatMap((r) => r.attempts);
  const counts = classes.map((c) => attempts.filter((a) => a.rawClass === c).length);
  line(`| ${v} | ${counts.map((c) => `${c} (${pct(c, attempts.length)})`).join(" | ")} |`);
}
line();
line("`clean_json` only means the text parsed as JSON; it can still fail the Intent schema (wrong type name, missing field).");
line();

// ---- schema failures
const issueCounts = new Map();
for (const r of records)
  for (const a of r.attempts)
    for (const i of a.issues ?? []) {
      const key = i.replace(/Expected .*/, "Expected <one of the 7 intent types>");
      issueCounts.set(key, (issueCounts.get(key) ?? 0) + 1);
    }
if (issueCounts.size) {
  line("## Most common schema validation failures");
  line();
  line("| Count | Zod issue |");
  line("|---|---|");
  for (const [issue, n] of [...issueCounts].sort((a, b) => b[1] - a[1]).slice(0, 12)) line(`| ${n} | \`${issue}\` |`);
  line();
}

// ---- grounding
const moneyCorrect = records.filter((r) => r.verdict === "correct" && r.grounding);
if (moneyCorrect.length) {
  const g = groupBy(moneyCorrect, (r) => r.grounding);
  line("## Grounding: do models emit real account/payee ids?");
  line();
  line(
    `Of ${moneyCorrect.length} correct money-moving parses, ${g.get("exact_id")?.length ?? 0} used a real id (e.g. \`acc-checking\`) and ${g.get("resolved")?.length ?? 0} used a name the app had to map (e.g. \`"checking"\`). The prompt never lists real ids, so a resolver between the model and the app is required.`,
  );
  line();
}

// ---- assumptions
const by = (pred) => stats(records.filter(pred));
const small = (r) => !/2b|Phi-3\.5|mini/i.test(r.modelId);
const a1 = models
  .filter((k) => small({ modelId: k }))
  .map((k) => ({ k, s: by((r) => `${r.platform}|${r.modelId}` === k && r.promptVariant === "v1_examples") }))
  .sort((x, y) => y.s.validCorrect / (y.s.validN || 1) - x.s.validCorrect / (x.s.validN || 1))[0];
const v0 = by((r) => r.promptVariant === "v0_field_list");
const v1 = by((r) => r.promptVariant === "v1_examples");
const v2 = by((r) => r.promptVariant === "v2_schema_constrained");
const all = by(() => true);
const unsafe = records.filter((r) => r.verdict === "unsafe_auto_allowed");

line("## Assumptions vs evidence");
line();
line("| # | Assumption | Evidence (from this run) |");
line("|---|---|---|");
if (a1)
  line(`| A1 | A ≤1.5B on-device model is good enough to parse banking intents (app prompt). | Best small model: ${short(a1.k.split("|")[1])} at ${frac(a1.s.validCorrect, a1.s.validN)} valid cases correct. |`);
line(`| A2 | One example per intent beats a bare field list. | Valid correct: v0 ${frac(v0.validCorrect, v0.validN)} → v1 ${frac(v1.validCorrect, v1.validN)}. |`);
if (v2.n)
  line(`| A3 | JSON-schema constrained decoding removes format failures. | Valid parse failures: v1 ${frac(v1.validParseFailed, v1.validN)} → v2 ${frac(v2.validParseFailed, v2.validN)}. Wrong slots v1 ${v1.validWrongSlots} → v2 ${v2.validWrongSlots}. |`);
line(`| A4 | Retries rescue bad first attempts. | ${all.rescued} of ${all.validCorrect} correct valid parses needed a retry. |`);
line(`| A5 | The closed Intent schema rejects out-of-scope injected actions. | ${all.advRejected}/${all.advN} adversarial runs produced nothing that validated. |`);
line(`| A6 | The guardrail stops injected money movement. | ${all.advUnsafe}/${all.advN} adversarial runs produced a transfer the guardrail would auto-execute${unsafe.length ? ` (e.g. ${short(unsafe[0].modelId)}/${unsafe[0].promptVariant} on "${unsafe[0].text}" → \`${JSON.stringify(unsafe[0].intent)}\`)` : ""}. |`);
line(`| A7 | Models leave missing details missing instead of inventing them. | ${frac(all.ambHallucinated, all.ambN)} ambiguous runs produced a money-moving intent with invented values. |`);
line(`| A8 | On-device latency is interactive (<2s). | Median ${secs(all.p50)}, p95 ${secs(all.p95)} across all runs; per model in the table above. |`);
line();

// ---- failure gallery
line("## Failure gallery");
line();
line("Up to 2 examples per model × prompt × failure type, last attempt shown verbatim (truncated to 300 chars).");
line();
const failures = records.filter((r) => !r.pass);
for (const [key, rs] of groupBy(failures, (r) => `${short(r.modelId)} · ${r.promptVariant} · ${r.verdict}`)) {
  line(`### ${key} (${rs.length})`);
  line();
  for (const r of rs.slice(0, 2)) {
    const last = r.attempts.at(-1);
    line(`- **${r.caseId}** "${r.text}" — ${r.slotIssues.join("; ") || r.error || last?.issues?.join("; ") || last?.rawClass || ""}`);
    if (last) {
      line("  ```");
      line(`  ${last.raw.slice(0, 300).replace(/\n/g, "\n  ")}`);
      line("  ```");
    }
  }
  line();
}

// ---- live app
line("## Live app usage");
line();
if (live.length === 0) {
  line("No live-app parses recorded yet (`evidence/live-app.jsonl` is written while using the app via the dev server).");
} else {
  const byOutcome = groupBy(live, (r) => r.outcome);
  line(`${live.length} parses recorded: ${[...byOutcome].map(([o, rs]) => `${o} ${rs.length}`).join(", ")}.`);
  line();
  line("| When | Model | Input | Outcome | Detail |");
  line("|---|---|---|---|---|");
  for (const r of live.filter((r) => r.outcome !== "parsed").slice(-20))
    line(`| ${r.timestamp} | ${short(r.modelId)} | ${r.text} | ${r.outcome} | ${(r.reason ?? r.error ?? "").slice(0, 160)} |`);
}
line();

writeFileSync(resolve(DIR, "REPORT.md"), out.join("\n"));
console.log(`Wrote evidence/REPORT.md (${records.length} records, ${live.length} live-app entries)`);
