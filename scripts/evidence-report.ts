/**
 * Builds evidence/REPORT.md from the raw evidence logs:
 *   evidence/eval.jsonl         one scored record per model x prompt x case (scripts/run-eval.mjs)
 *   evidence/eval-models.jsonl  one record per model load
 *   evidence/live-app.jsonl     every parse made while using the real app
 *
 * Only the latest run per (platform, model, prompt variant) is used, so
 * re-running one model or variant replaces its numbers without deleting
 * history from the logs. Every record is RE-SCORED with the current scorer
 * (packages/core/src/eval/scoring.ts) from its stored intent, so old and new
 * runs are judged by the same rules, and each gets both a "model only" and a
 * "model + code grounding" verdict.
 *
 *   pnpm evidence:report
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EVAL_CASES, REFERENCE_CONTEXT, TEST_CASES, caseSplit, scoreCase, type EvalRecord } from "../packages/core/src/eval";
import { groundIntent, resolveAccount } from "../packages/core/src/grounding";

const DIR = resolve(import.meta.dirname, "../evidence");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const readJsonl = (name: string): Any[] =>
  existsSync(resolve(DIR, name))
    ? readFileSync(resolve(DIR, name), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

const allEval = readJsonl("eval.jsonl");
const allModels = readJsonl("eval-models.jsonl");
const live = readJsonl("live-app.jsonl");

// latest runId per platform+model+variant
const latestRunId = new Map<string, { runId: string; timestamp: string }>();
for (const r of allEval) {
  const key = `${r.platform}|${r.modelId}|${r.promptVariant}`;
  const prev = latestRunId.get(key);
  if (!prev || prev.timestamp < r.timestamp) latestRunId.set(key, { runId: r.runId, timestamp: r.timestamp });
}
const usedRunIds = new Set([...latestRunId.values()].map((v) => v.runId));
const modelRows: Any[] = [];
for (const m of allModels) {
  const i = modelRows.findIndex((x) => x.platform === m.platform && x.modelId === m.modelId);
  if (!usedRunIds.has(m.runId)) continue;
  if (i === -1) modelRows.push(m);
  else if (modelRows[i].timestamp < m.timestamp) modelRows[i] = m;
}
const caseById = new Map([...EVAL_CASES, ...TEST_CASES].map((c) => [c.id, c]));
const scored: EvalRecord[] = allEval
  .filter((r) => latestRunId.get(`${r.platform}|${r.modelId}|${r.promptVariant}`)?.runId === r.runId)
  .map((r): EvalRecord => {
    const evalCase = caseById.get(r.caseId);
    if (!evalCase || r.verdict === "engine_error") return r;
    return { ...r, ...scoreCase(evalCase, { ok: r.intent != null, intent: r.intent, retriesUsed: r.retriesUsed, attempts: r.attempts }) };
  });
const isTest = (r: EvalRecord) => {
  const c = caseById.get(r.caseId);
  return c !== undefined && caseSplit(c) === "test";
};
// Everything below the held-out section describes the dev split (the 28 tuning cases).
const records = scored.filter((r) => !isTest(r));
const testRecords = scored.filter(isTest);

const short = (id: string) => id.replace(/-q4f16_1-MLC$/, "").replace(/-MLC$/, "");
const pct = (n: number, d: number) => (d === 0 ? "–" : `${Math.round((100 * n) / d)}%`);
const frac = (n: number, d: number) => `${n}/${d} (${pct(n, d)})`;
const quantile = (xs: number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? null;
};
const secs = (ms: number | null | undefined) => (ms == null ? "–" : `${(ms / 1000).toFixed(2)}s`);
const groupBy = <T, K>(xs: T[], f: (x: T) => K) =>
  xs.reduce((m, x) => m.set(f(x), [...(m.get(f(x)) ?? []), x]), new Map<K, T[]>());
const variantOrder = ["v0_field_list", "v1_examples", "v2_schema_constrained", "v3_grounded", "v4_two_stage"];
const models = [...new Set(records.map((r) => `${r.platform}|${r.modelId}`))];
const variants = variantOrder.filter((v) => records.some((r) => r.promptVariant === v));

function leavesUser(r: EvalRecord, grounded: boolean): boolean {
  if (!r.intent || r.intent.type !== "transfer_internal") return false;
  const intent = grounded ? groundIntent(r.intent, REFERENCE_CONTEXT).intent : r.intent;
  return intent.type === "transfer_internal" && resolveAccount(intent.toAccountId, REFERENCE_CONTEXT).id === null;
}

function stats(rs: EvalRecord[]) {
  const valid = rs.filter((r) => r.category === "valid");
  const amb = rs.filter((r) => r.category === "ambiguous");
  const adv = rs.filter((r) => r.category === "adversarial");
  const decode = rs.map((r) => (r.usage as Any)?.extra?.decode_tokens_per_s).filter((x): x is number => typeof x === "number");
  const g = (cat: string) => rs.filter((r) => r.category === cat).map((r) => r.grounded);
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
    ambAsked: amb.filter((r) => r.verdict === "asked_clarification").length,
    ambN: amb.length,
    advUnsafe: adv.filter((r) => r.verdict === "unsafe_auto_allowed").length,
    advGuarded: adv.filter((r) => r.verdict === "guarded").length,
    advRejected: adv.filter((r) => r.verdict === "safe_rejected").length,
    advN: adv.length,
    engineErrors: rs.filter((r) => r.verdict === "engine_error").length,
    gValidCorrect: g("valid").filter((x) => x.verdict === "correct").length,
    gValidRejected: g("valid").filter((x) => x.verdict === "grounding_rejected").length,
    gValidCaught: g("valid").filter((x) => x.verdict === "wrong_caught").length,
    gAmbSafe: g("ambiguous").filter((x) => x.pass).length,
    gAmbHallucinated: g("ambiguous").filter((x) => x.verdict === "hallucinated_slots").length,
    gAdvUnsafe: g("adversarial").filter((x) => x.verdict === "unsafe_auto_allowed").length,
    // Auto-allowed attacks whose destination is NOT one of the user's accounts: money would leave the user.
    advMoneyLeaves: adv.filter((r) => r.verdict === "unsafe_auto_allowed" && leavesUser(r, false)).length,
    gAdvMoneyLeaves: adv.filter((r) => r.grounded.verdict === "unsafe_auto_allowed" && leavesUser(r, true)).length,
    p50: quantile(rs.map((r) => r.totalLatencyMs), 0.5),
    p95: quantile(rs.map((r) => r.totalLatencyMs), 0.95),
    decode: quantile(decode, 0.5),
  };
}

const out: string[] = [];
const line = (s = "") => out.push(s);

line("# Evidence report");
line();
line(`Generated ${new Date().toISOString()} by \`scripts/evidence-report.mjs\` from \`evidence/*.jsonl\`. Do not edit by hand.`);
line();
const gpu = modelRows.find((m) => m.gpu)?.gpu;
const ua = modelRows.find((m) => m.userAgent)?.userAgent;
line(`- **Hardware:** ${gpu ? `WebGPU adapter ${gpu.vendor} / ${gpu.architecture}` : "unknown"}`);
if (ua) line(`- **Browser:** \`${ua}\``);
line(`- **Records:** ${records.length} scored dev-split runs across ${models.length} models × ${variants.length} prompt variants, plus ${testRecords.length} held-out test-split runs (latest run per model and variant).`);
line(`- **Verdict meanings:** see \`packages/core/src/eval/scoring.ts\`; labeled cases in \`packages/core/src/eval/cases.ts\`.`);
line();

// ---- held-out test split: the numbers to quote
const passRate = (rs: EvalRecord[], f: (r: EvalRecord) => boolean) => frac(rs.filter(f).length, rs.length);
if (testRecords.length) {
  line("## Held-out test split — success of the full pipeline (model + code)");
  line();
  line(
    `${TEST_CASES.length} cases written and committed before tuning (\`packages/core/src/eval/cases-test.ts\`), never used while tuning. Success = valid request executed correctly / ambiguous request answered with a question or refused / attack never auto-executed, after grounding.`,
  );
  line();
  line("| Model | Prompt | Overall success | Valid correct | Ambiguous safe | Attacks safe | Money leaves user | p50 | p95 |");
  line("|---|---|---|---|---|---|---|---|---|");
  const testModels = [...new Set(testRecords.map((r) => r.modelId))];
  for (const m of testModels)
    for (const v of variantOrder) {
      const rs = testRecords.filter((r) => r.modelId === m && r.promptVariant === v);
      if (!rs.length) continue;
      const s = stats(rs);
      line(
        `| ${short(m)} | ${v} | **${passRate(rs, (r) => r.grounded.pass)}** | ${passRate(rs.filter((r) => r.category === "valid"), (r) => r.grounded.pass)} | ${passRate(rs.filter((r) => r.category === "ambiguous"), (r) => r.grounded.pass)} | ${passRate(rs.filter((r) => r.category === "adversarial"), (r) => r.grounded.pass)} | ${s.gAdvMoneyLeaves} | ${secs(s.p50)} | ${secs(s.p95)} |`,
      );
    }
  line();
  const fails = testRecords.filter((r) => !r.grounded.pass);
  if (fails.length) {
    line("<details><summary>Held-out failures (" + fails.length + ")</summary>");
    line();
    for (const r of fails)
      line(`- ${short(r.modelId)} · ${r.promptVariant} · **${r.caseId}** "${r.text}" → ${r.grounded.verdict}: \`${JSON.stringify(r.intent)?.replace(/"rawInputSummary":"[^"]*",?/, "") ?? r.attempts.at(-1)?.rawClass}\``);
    line();
    line("</details>");
    line();
  }
}

// ---- model loads
line("## Model loading");
line();
line("| Model | Load | Warm-up (shader compile) | Load error |");
line("|---|---|---|---|");
for (const m of modelRows) line(`| ${short(m.modelId)} (${m.platform}) | ${secs(m.loadMs)} | ${secs(m.warmupMs)} | ${m.loadError ?? ""} |`);
line();
line("Load time includes the download on first run and is a cache hit afterwards; compare runs before quoting it.");
line();

// ---- headline: model only vs model + code, per prompt variant
line("## Headline: prompt variant × code grounding (all models pooled)");
line();
line("\"Model only\" scores the parsed intent as-is. \"+ code\" passes it through `groundIntent` (packages/core/src/grounding.ts) first, which maps names to real ids and rejects or questions anything that doesn't match the user's real accounts, payees and balances — what the app actually executes.");
line();
line("| Prompt | Valid correct (model only) | Valid correct (+ code) | Ambiguous: invented slots (model only) | Ambiguous: invented slots (+ code) | Adversarial auto-allowed (model only) | …of which money leaves the user | Adversarial auto-allowed (+ code) | …of which money leaves the user | p50 | p95 |");
line("|---|---|---|---|---|---|---|---|---|---|---|");
for (const v of variants) {
  const s = stats(records.filter((r) => r.promptVariant === v));
  line(
    `| ${v} | ${frac(s.validCorrect, s.validN)} | ${frac(s.gValidCorrect, s.validN)} | ${frac(s.ambHallucinated, s.ambN)} | ${frac(s.gAmbHallucinated, s.ambN)} | ${frac(s.advUnsafe, s.advN)} | ${s.advMoneyLeaves} | ${frac(s.gAdvUnsafe, s.advN)} | ${s.gAdvMoneyLeaves} | ${secs(s.p50)} | ${secs(s.p95)} |`,
  );
}
line();
line("\"Money leaves the user\" = the auto-allowed transfer's destination is not one of the user's accounts. The remaining auto-allowed attacks are unrequested transfers between the user's own accounts (amount ≤ 1000, which the policy auto-allows). In v3 the account-id enum forces an attacker's destination onto a real account, which hides the attack from grounding — see the phase-8 log.");
line();

// ---- main matrix
line("## Results by model and prompt variant (model only)");
line();
line("| Model | Prompt | Valid: correct | + code | 1st try | Rescued by retry | Parse failed | Wrong intent | Wrong slots | Ambiguous: asked | Ambiguous: invented slots | Adversarial: auto-allowed | + code | p50 | p95 | Decode tok/s |");
line("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const key of models) {
  for (const v of variants) {
    const rs = records.filter((r) => `${r.platform}|${r.modelId}` === key && r.promptVariant === v);
    if (rs.length === 0) continue;
    const s = stats(rs);
    line(
      `| ${short(key.split("|")[1]!)} | ${v} | ${frac(s.validCorrect, s.validN)} | ${frac(s.gValidCorrect, s.validN)} | ${s.firstTry} | ${s.rescued} | ${s.validParseFailed} | ${s.validWrongIntent} | ${s.validWrongSlots} | ${s.ambAsked} | ${frac(s.ambHallucinated, s.ambN)} | ${frac(s.advUnsafe, s.advN)} | ${s.gAdvUnsafe} | ${secs(s.p50)} | ${secs(s.p95)} | ${s.decode ? Math.round(s.decode) : "–"} |`,
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
const issueCounts = new Map<string, number>();
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
const by = (pred: (r: EvalRecord) => boolean) => stats(records.filter(pred));
const small = (r: { modelId: string }) => !/2b|Phi-3\.5|mini/i.test(r.modelId);
const a1 = models
  .filter((k) => small({ modelId: k }))
  .map((k) => ({ k, s: by((r) => `${r.platform}|${r.modelId}` === k && r.promptVariant === "v1_examples") }))
  .sort((x, y) => y.s.validCorrect / (y.s.validN || 1) - x.s.validCorrect / (x.s.validN || 1))[0];
const v0 = by((r) => r.promptVariant === "v0_field_list");
const v1 = by((r) => r.promptVariant === "v1_examples");
const v2 = by((r) => r.promptVariant === "v2_schema_constrained");
const v3 = by((r) => r.promptVariant === "v3_grounded");
const all = by(() => true);
const firstUnsafe = records.find((r) => r.verdict === "unsafe_auto_allowed");

line("## Assumptions vs evidence");
line();
line("| # | Assumption | Evidence (from this run) |");
line("|---|---|---|");
if (a1)
  line(`| A1 | A ≤1.5B on-device model is good enough to parse banking intents (app prompt). | Best small model: ${short(a1.k.split("|")[1]!)} at ${frac(a1.s.validCorrect, a1.s.validN)} valid cases correct. |`);
line(`| A2 | One example per intent beats a bare field list. | Valid correct: v0 ${frac(v0.validCorrect, v0.validN)} → v1 ${frac(v1.validCorrect, v1.validN)}. |`);
if (v2.n)
  line(`| A3 | JSON-schema constrained decoding removes format failures. | Valid parse failures: v1 ${frac(v1.validParseFailed, v1.validN)} → v2 ${frac(v2.validParseFailed, v2.validN)}. Wrong slots v1 ${v1.validWrongSlots} → v2 ${v2.validWrongSlots}. |`);
line(`| A4 | Retries rescue bad first attempts. | ${all.rescued} of ${all.validCorrect} correct valid parses needed a retry. |`);
line(`| A5 | The closed Intent schema rejects out-of-scope injected actions. | ${all.advRejected}/${all.advN} adversarial runs produced nothing that validated. |`);
line(`| A6 | The guardrail stops injected money movement. | ${all.advUnsafe}/${all.advN} adversarial runs produced a transfer the guardrail would auto-execute${firstUnsafe ? ` (e.g. ${short(firstUnsafe.modelId)}/${firstUnsafe.promptVariant} on "${firstUnsafe.text}" → \`${JSON.stringify(firstUnsafe.intent)}\`)` : ""}. |`);
line(`| A7 | Models leave missing details missing instead of inventing them. | ${frac(all.ambHallucinated, all.ambN)} ambiguous runs produced a money-moving intent with invented values. |`);
line(`| A8 | On-device latency is interactive (<2s). | Median ${secs(all.p50)}, p95 ${secs(all.p95)} across all runs; per model in the table above. |`);
line(`| A9 | Code-side grounding closes what the guardrail misses. | Adversarial auto-allowed: ${all.advUnsafe} model only → ${all.gAdvUnsafe} with grounding. Correct parses wrongly refused by grounding: ${all.gValidRejected}/${all.validN}. Wrong parses stopped before execution (asked instead): ${all.gValidCaught}. |`);
if (v3.n)
  line(`| A10 | Giving the model real ids, a clarify option and input→output examples (v3) beats v2. | Valid correct v2 ${frac(v2.validCorrect, v2.validN)} → v3 ${frac(v3.validCorrect, v3.validN)}; ambiguous invented slots v2 ${frac(v2.ambHallucinated, v2.ambN)} → v3 ${frac(v3.ambHallucinated, v3.ambN)}; p50 v2 ${secs(v2.p50)} → v3 ${secs(v3.p50)} (longer prompt). |`);
line();

// ---- failure gallery
line("## Failure gallery");
line();
line("Up to 2 examples per model × prompt × failure type, last attempt shown verbatim (truncated to 300 chars).");
line();
const failures = records.filter((r) => !r.pass);
for (const [key, rs] of groupBy(failures, (r) => `${short(r.modelId)} · ${r.promptVariant} · ${r.verdict}`)) {
  if (!rs) continue;
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
  const byOutcome = groupBy(live, (r: Any) => r.outcome as string);
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
