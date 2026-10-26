# Implementation log — index

Phase-by-phase record of what was built for `technical-implementation-plan.md`, kept
as it happened rather than reconstructed afterward.

- [Phase 1 — Schemas and guardrail](./phase-1-schemas-guardrail.md) — complete, fully
  verified (pure Node/TypeScript, no browser dependency).
- [Phase 2 — Intent parser (WebLLM)](./phase-2-intent-parser.md) — harness + retry
  logic built and unit-tested; real WebGPU bake-off numbers not captured (largest gap
  in the build, root-caused in Phase 3's log).
- [Phase 3 — Web mock app + adapter](./phase-3-web-demo.md) — complete and
  live-verified in a real Chrome instance (rendering, interactivity, end-to-end chat
  wiring); real WebLLM inference blocked specifically by headless-mode GPU
  restrictions, root-caused as an environment limitation, not an app defect.
- [Phase 4 — Mobile adapter](./phase-4-mobile-demo.md) — built, fully unit-tested, and
  Metro-bundle-verified (704 modules resolve and package correctly); real simulator
  boot deferred to a follow-up pass per explicit instruction.
- [Phase 5 — Demo script + recordings](./phase-5-demo-script.md) — script written and
  cross-checked against the real app; video recordings not captured (no screen-capture
  capability in this build environment), tracked as an explicit outstanding task.
- [Phase 6 — Visual redesign + guided tour](./phase-6-redesign-and-tour.md) — post-hoc
  addition (not in the original phased plan): full dark-theme visual redesign of the
  web app and agent panel, plus a self-built in-app guided tour with 6 steps that
  drive the real agent pipeline live. Live-verified in Chrome via CDP.
- [Phase 7 — Category-aware search, response timing, unhandled-intent logging](./phase-7-search-timing-unhandled-intents.md) —
  post-hoc addition: transaction search now matches on category/synonyms (fixes
  "drinking and eating" not matching "Coffee Shop"), agent replies show elapsed
  response time, and any intent with no screen gets a real audit-log entry plus a
  generic "logged for a future iteration" message. Search fix and timing badge
  live-verified in Chrome via CDP.

- [Phase 8 — Real-model evidence, v3 prompt, code-side grounding](./phase-8-evidence-and-grounding.md) —
  closes the Phase 2/3 gap: 672 real WebGPU runs (6 models × 4 prompt variants × 28
  labeled cases) driven through headed Chrome. Adds `need_clarification`, a grounding
  layer that enforces the policy's never-checked "same owner" condition, and
  `evidence/REPORT.md`. Mobile on-device LLM deferred.

## Aggregated deviations from spec

| # | What | Where | Why |
|---|---|---|---|
| 1 | Added `GetTransactionsIntent` / `ScheduleRecurringPaymentIntent` field shapes | `core/src/schema/intent.ts` | Spec names both types but only says "add ... similarly," without defining fields |
| 2 | Added `recurring-payment-always-confirm` policy rule | `core/src/policy.config.ts` | Spec's 5 given rules never cover `schedule_recurring_payment`; without this it would silently fall to the fail-safe block |
| 3 | `riskTierForIntent()` derived function | `core/src/schema/intent.ts` | Spec defines `RiskTier` but never wires it to `Intent`/`PolicyRule`, though spec 4.4 references it as if it exists |
| 4 | `RULE_PREDICATES` map, separate from `PolicyRule.condition` | `core/src/policy.config.ts` | Spec's `condition: z.string()` is display-only; real threshold logic (`amount <= 1000`) needs to live somewhere executable |
| 5 | `core` package export-map split (`.` vs `./web`) | `core/package.json` | Not in spec's flat file tree; needed so Metro/RN never resolves `@mlc-ai/web-llm`'s browser-only code |
| 6 | Fail-safe "block" on no policy match | `core/src/guardrail.ts` | Spec doesn't specify a no-match behavior; fail-closed is the only defensible default for a security boundary |
| 7 | npm scope `@web-ai-trials/*`, not spec's example `@agent-demo/*` | all `package.json` | User's explicit choice — matches actual repo name |
| 8 | zod v4.5.2, not v3 | all `package.json` | User's explicit choice, overriding an earlier ecosystem-compatibility-based draft recommendation |
| 9 | Bake-off test file renamed `intent-parser.bake.test.ts` | `core/src/` | Vitest's default include pattern doesn't match `*.baketest.ts` |
| 10 | Stripped `.js` extensions from all relative imports in `core/src` | `core/src/**` | Broke Jest and Metro module resolution (both resolve against the real `.ts` file, not a nonexistent `.js` sibling); Vite/Vitest had tolerated it, masking the issue until Phase 4 |
| 11 | Native module versions corrected via `npx expo install` | `mobile-demo/package.json` | Initial hand-picked versions failed `expo-doctor`'s SDK-57 compatibility check |
| 12 | Reconnect-drain UX: confirm-tier items retained in queue, not dropped | `mobile-demo/src/agent/reconnectDrain.ts` | Plan's own instruction to "decide and document" this — avoids silently losing a pending confirmation |

## What was actually run/verified live vs. built-and-tested-only

| Component | Unit tests | Typecheck | Live-run verification |
|---|---|---|---|
| `core` (schemas, guardrail, policy) | ✅ 40 tests | ✅ | ✅ `pnpm demo:guardrail` runs and prints correct output |
| `core` intent-parser retry/validation logic | ✅ 10 tests (stub engine) | ✅ | ❌ real WebGPU/WebLLM inference not exercised (see phase-2, phase-3 gap notes) |
| `web-demo` app + adapter + injection scenario | ✅ 6 tests | ✅ | ✅ live in real Chrome: rendering, 4-screen interactivity, end-to-end chat→parser→engine wiring, production build; ❌ real model inference (headless GPU limitation) |
| `mobile-demo` offline logic | ✅ 16 tests | ✅ | ✅ Metro bundle succeeds (704 modules); ❌ real simulator boot (deferred per instruction) |

**Total: 62 tests passing across the workspace, 0 failing, typecheck clean in every package.**

## One more honest gap: no linter configured

Every package's `lint` script is currently a stub (`echo '...' && exit 0`) — no ESLint
(or equivalent) was set up in this pass. This wasn't called for explicitly in the
approved plan's task list, but the root `package.json` does define a `lint` script as
if one existed, which is misleading as-is. Recommended follow-up: add a shared ESLint
config (flat config, `@typescript-eslint`) at the root and wire each package's `lint`
script to it before treating "green lint" as a real signal.
