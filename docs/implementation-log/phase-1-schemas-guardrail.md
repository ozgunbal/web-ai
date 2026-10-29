# Phase 1 — Schemas and guardrail

Status: **complete, fully verified in this environment.**

## What was built

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore` (repo root)
- `packages/core/package.json`, `tsconfig.json` — package `@web-ai/core`
- `packages/core/src/schema/intent.ts` — zod v4 discriminated union for all 6 intent
  types, plus `riskTierForIntent()`
- `packages/core/src/schema/policy.ts` — `Decision`, `PolicyRule` zod schemas
- `packages/core/src/policy.config.ts` — `POLICY_RULES` (6 rules) + `RULE_PREDICATES`
- `packages/core/src/guardrail.ts` — `evaluateIntent()`, pure function, fail-safe to block
- `packages/core/src/audit-log.ts` — `AuditLog` class for structured logging
- `packages/core/src/index.ts` — mobile-safe export surface (no WebLLM)
- `packages/core/src/index.web.ts` — full export surface (adds intent-parser)
- `packages/core/src/cli/demo-guardrail.ts` — `pnpm demo:guardrail` CLI
- `packages/core/src/schema/schema.test.ts` — 17 tests
- `packages/core/src/guardrail.test.ts` — 13 tests

## Decisions made (beyond literal spec text)

1. **`GetTransactionsIntent` / `ScheduleRecurringPaymentIntent` field shapes** — spec
   section 3.1 lists both in the `IntentType` enum but only says "add ... similarly,"
   without defining fields. We designed:
   - `GetTransactionsIntent`: all filters (`accountId`, `fromDate`, `toDate`, `query`)
     optional, since "show me my transactions" has no required slot.
   - `ScheduleRecurringPaymentIntent`: `payeeId`, `amount`, `currency` (default USD),
     `frequency` (weekly/biweekly/monthly enum), `startDate`.
2. **`riskTierForIntent()` as a derived function, not a stored field.** Spec defines
   `RiskTier` (section 3.2) but never wires it onto `Intent` or `PolicyRule`, even
   though spec section 4.4 (mobile queue) references `riskTier !== "read_only"` as if
   it already exists on an intent. Deriving it from the intent *type* in code (not
   trusting a value an LLM could produce) keeps the security boundary in code.
3. **`RULE_PREDICATES` map, separate from `PolicyRule.condition`.** Spec 3.2 defines
   `condition: z.string()` as human-readable display text, but spec 3.3's actual rules
   embed real thresholds ("amount <= 1000") that must be evaluated, not just displayed.
   We kept `condition` as pure display text on the zod-validated `PolicyRule` and added
   a co-located `RULE_PREDICATES: Record<ruleId, (intent) => boolean>` for the real
   evaluation logic. This is an interpretation, not literal from spec.
4. **Added `recurring-payment-always-confirm` policy rule.** Spec's 5 given rules never
   cover `schedule_recurring_payment` — without an added rule, it would silently fall
   through to the fail-safe "block." We added an explicit "always confirm" rule instead,
   since blocking recurring payment setup outright seemed like an unintended gap rather
   than an intended security posture; flagged here for the user/PO to review.
5. **npm scope: `@web-ai/*`** (per user's explicit choice), not the spec's example
   `@agent-demo/*` — the spec's own folder-name example (`agent-demo/`) doesn't match
   this repo's actual name (`web-ai`).
6. **zod v4.5.2** (exact-pinned), per user's explicit choice, not v3 as a Plan-agent
   draft had initially suggested for ecosystem-compatibility reasons. No API
   incompatibilities were hit for the schema patterns used here (`z.object`, `.extend`,
   `z.discriminatedUnion`, `z.enum`).
7. **`core` package exports split** (`.` vs `./web`) via `package.json` `exports` map —
   not shown in spec's flat `core/src/index.ts` file tree — so that mobile-demo (Metro
   bundler) never has to resolve `@mlc-ai/web-llm`'s browser/WASM/worker code.
8. **Guardrail fail-safe rule** (`no-matching-policy-fail-safe`, id synthesized) returns
   `block` when no policy rule matches — spec says "first match wins" but doesn't say
   what happens on no match; we chose fail-closed as the only defensible default for a
   security-boundary component.

## Deviations from spec

- Two additional intent field-shapes (item 1 above) not given literally in spec text.
- One additional policy rule (item 4) not in spec's list of 5.
- `riskTier` computation location (item 2) — spec shows the type but not how/where
  it's computed.
- `RULE_PREDICATES` split (item 3) — spec's `condition` field is display-only here,
  not executable, which is a reinterpretation of how policy.config.ts's rules actually
  enforce the amount threshold shown in spec 3.3.

## Test results (actual)

```
pnpm --filter @web-ai/core typecheck   → PASS, no errors
pnpm --filter @web-ai/core test         → PASS, 2 files, 30 tests, 30 passed, 0 failed
pnpm demo:guardrail                            → runs successfully, output matches
                                                  expected decisions for all 7 sample intents
```

Guardrail test coverage includes every policy rule (allow/confirm/block), the
`amount <= 1000` boundary exactly at 1000, the "new payee blocked regardless of
amount" invariant, fail-safe-to-block for an unrecognized intent type, first-match-wins
ordering (via a synthetic overlapping-rule test), and that every real `POLICY_RULES`
entry has a corresponding predicate.

## Known gaps / unverified items

None for this phase — schemas, guardrail, and the CLI demo are pure Node/TypeScript
with no browser/native dependency, and are fully built, typechecked, tested, and run
in this environment.
