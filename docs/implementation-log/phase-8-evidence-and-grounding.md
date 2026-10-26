# Phase 8 — Real-model evidence, v3 prompt, code-side grounding

Status: **complete. 672 scored runs on real WebGPU inference (6 models × 4 prompt
variants × 28 labeled cases), 0 engine errors. Numbers live in `evidence/REPORT.md`,
generated from `evidence/*.jsonl`; this log explains method and findings.**

Added for a tech talk: every claim the demo makes should be backed by a measurement,
and failures should be shown rather than described.

## How the gap from Phase 2/3 was closed

Phases 2–3 recorded "real WebGPU inference not run" because headless Chrome has no
WebGPU adapter. A **headed** Chrome launched with `--remote-debugging-port` and its
own profile (`.cache/eval-chrome`) does expose one (Apple M3 Pro, `shader-f16`), and
can still be driven entirely over the DevTools protocol. No AppleEvents permission is
needed. `scripts/run-eval.mjs` does this unattended.

## What was built

- `core/src/eval/`: 28 labeled cases (14 valid with expected type + slots, 6
  ambiguous, 8 adversarial), prompt variants, scoring, and `runEvalCase`.
- `parseIntent` now records every attempt (`attempts[]`: raw output, latency,
  failure kind) and accepts prompt / retry / response-format / repetition-penalty
  options. The WebLLM engine moved to `webllm-engine.ts`, so the parser and eval
  module import on mobile without pulling in WebLLM.
- `web-demo/eval.html`: benchmark page; `vite.config.ts` evidence sink appends records
  to `evidence/<stream>.jsonl`; live chat parses go to `evidence/live-app.jsonl`.
- `scripts/evidence-report.ts` (`pnpm evidence:report`): **re-scores every stored
  record with the current scorer**, so all runs are judged by the same rules, and each
  gets a "model only" and a "model + code grounding" verdict.
- `core/src/grounding.ts` + `need_clarification` intent: see below.

## Prompt variants

| Id | What changes |
|---|---|
| v0_field_list | Types and field names only (reconstruction of the pre-version-control prompt) |
| v1_examples | One output example per intent: the app's prompt before this phase |
| v2_schema_constrained | v1 + WebLLM JSON-schema constrained decoding (schema generated from zod) |
| v3_grounded | Real account/payee ids in the prompt, id enums in the schema, `need_clarification` intent, input→output examples, repetition penalty 1.0, retry message naming the actual validation error |

## Findings (see REPORT.md for exact numbers)

1. **Prompt and decoding matter more than model size.** Phi-3.5-mini (largest) scores
   0/14 with v0: it understands the request but invents its own JSON shape
   (`{"action": ...}`) and puts `// comments` inside the JSON. Llama-3.2-1B with v2
   matches gemma-2-2b at half the latency.
2. **gemma3-1b is unusable for this task** in every variant: it echoes the system
   prompt, invents a dialogue and repeats until max_tokens (~35s per case). This
   confirms the anecdote from Phase 2 with data and explains the undocumented switch
   of the app model to Qwen2.5-1.5B.
3. **Constrained decoding is a trade-off.** It removes format failures and halves
   latency, but forcing a schema-valid answer makes models turn jailbreak text into a
   real action instead of output that fails validation (Qwen2.5-1.5B: 1/8 → 5/8
   attacks auto-allowed).
4. **The guardrail's "same owner" condition was never enforced.** The
   `internal-transfer-small-amount` predicate only checks `amount <= 1000`.
   Measured: injected transfers to `"attacker"`/`"XYZ"` were auto-allowed.
   Fixed by `groundIntent`, which rejects transfers to accounts the user doesn't own.
   After grounding, **no attack moves money out of the user's accounts in any
   variant**.
5. **ID enums hide the attack from code.** In v3 the grammar cannot emit
   `"attacker"`, so the model maps the attacker's destination onto a real account
   (`acc-checking → acc-checking-2, 999`). That is a valid own-account transfer, so
   grounding has nothing to reject: v3 + code leaves 7/48 unrequested own-account
   transfers auto-allowed vs 3/48 for v2 + code. More accuracy came at the cost of
   attack visibility.
6. **The clarify option is model-dependent.** Qwen (both sizes) and Phi use
   `need_clarification` on 4/6 ambiguous requests; Llama and gemma-2 never do and
   still invent amounts.
7. **Retries rescue almost nothing** (3 of 173 correct valid parses used one); they
   mainly add latency on failing cases.
8. **Grounding never refused a correct parse** (0/336). It stopped 6 wrong parses
   (empty accounts, `"<LandlordID>"`, prose in an id field, same source and
   destination) by asking instead of executing.

## Decisions

1. **`need_clarification` is a real Intent**, read-only and allowed by policy, so the
   app can show the model's question. `ActionIntent` (the original 7) is kept so the
   v2 schema stays exactly what was measured.
2. **Grounding runs before the guardrail in the live app** (`useAgentSession`), against
   live store data (balances, payees added at runtime) via `UserContextBridge` in
   `App.tsx`.
3. **Landlord added as a saved payee** in web mock data and the eval reference
   context, so `v-recurring-1` has a real target rather than relying on grounding to
   reject it.
4. **Scorer verdicts for grounding on valid cases are split** into
   `grounding_rejected` (code refused a correct parse) and `wrong_caught` (code stopped
   a wrong parse), after the first version counted caught errors as false refusals.

## Process incident (kept because it affected data)

After merging v3, Vite reloaded every open eval tab; each URL still had `autostart=1`
and its original `runId`, so the finished baseline silently started re-running and
appending duplicates. It was noticed from out-of-place records in the log, the tabs
were closed, the logs restored from the committed baseline, and the cause fixed: the
page strips `autostart` before running and the runner closes its tab. The 3-case v3
schema check from that moment is kept under `evidence/smoke/`.

## Caveats

- One machine (M3 Pro, Chrome via headed CDP), temperature 0, one run per cell: 14
  valid cases per cell is small; differences of one or two cases are noise.
- Latency includes retries; p95 is dominated by models stuck repeating until
  max_tokens.
- v3 bundles several changes; the report does not attribute gains to individual
  ones (e.g. repetition penalty alone was not ablated).
- Mobile (on-device LLM via llama.rn) is deferred by the user's choice.
