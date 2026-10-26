# Phase 7 — Category-aware search, response timing, generic unhandled-intent logging

Status: **complete, live-verified in Chrome for the search fix and the timing badge's
visual rendering; the unhandled-intent logging and full LLM-driven timing are verified
at the unit-test level, same environment gap as every prior LLM-dependent change.**

Post-hoc addition — three real gaps surfaced from actually using the demo, not part of
the original phased plan.

## What was built

### A. Category-aware transaction search

- `packages/shared/src/index.ts`: added `TRANSACTION_CATEGORIES` (closed enum:
  `food_drink`, `groceries`, `utilities`, `income`, `housing`, `transfer`) and a
  required `Transaction.category` field.
- `packages/web-demo/src/mock-data/transactions.ts`: seeded categories on all 7
  transactions; the injection-scenario fixture transaction got `transfer` (its
  id/description/note/injection wiring untouched).
- `packages/web-demo/src/mock-data/store.tsx`: the three reducer actions that
  synthesize new transactions (transfer, pay known payee, add-payee-and-pay) now tag
  them `category: "transfer"`.
- New `packages/web-demo/src/mock-data/transactionSearch.ts`: a deterministic
  keyword→category synonym table + `matchesQuery()` — checks literal description
  substring, literal category-name substring, then word-by-word synonym overlap
  against the transaction's category. This is the real fix: it works regardless of
  what the model's `query` field ends up containing, since matching happens app-side
  against known synonyms rather than hoping for literal substring luck.
- `packages/web-demo/src/app/TransactionsScreen.tsx`: uses `matchesQuery` instead of
  the old `description`-only substring filter; renders a small category pill per row
  (new `.tx-category-pill` CSS).
- `packages/core/src/intent-parser.ts`: added one more `get_transactions` example to
  `SYSTEM_PROMPT` (`{"query": "food"}`) as a secondary, optional nudge — the
  deterministic matcher above is the real fix and doesn't depend on this.

### B. Elapsed response time in chat

- `AgentMessage` gained `elapsedMs?: number`, set only on `role: "agent"` messages.
- `send()`: captures `startedAt = Date.now()` once at the top; all 6 existing
  agent-message push sites (engine error, parse failure, block, confirm-needed,
  screen-check failure, final success/exec-failure) now include
  `elapsedMs: Date.now() - startedAt`.
- `confirm()`: separate timing captured fresh at the top of the function — measures
  time since the Confirm click, not since the original message, since that's the
  actual latency the user experiences for that specific interaction (deliberately not
  conflating it with however long the user spent reading the confirm dialog).
- `AgentOverlay.tsx` + `agent.css`: renders a small `.elapsed-badge` pill
  (`"1.8s"`-style) next to agent replies that have a measured time, styled adjacent to
  the existing `.decision-badge` pattern but in a neutral/muted color since latency
  isn't a decision outcome.

### C. Generic "logged for a future iteration" pattern

- Reused the existing `AuditLog` class (`packages/core/src/audit-log.ts`) rather than
  building a new logging module — it already has exactly the right shape.
- `useAgentSession.ts`'s `ensureCorrectScreen`: when `INTENT_SCREEN_MAP[intent.type]`
  is `null` (today only `schedule_recurring_payment`), calls
  `auditLogRef.current.recordRejected(intent.rawInputSummary, ...)` before returning,
  and the returned chat message is now generic — reads `intent.type` directly rather
  than hardcoding wording for one action, so any future null-mapped intent type gets
  the same real, timestamped record and the same message shape automatically.

## Decisions made

1. **Closed category enum, not a free string** — lets the synonym table be
   exhaustively typed against real values and prevents typo-drift across mock data.
2. **Deterministic app-side matching as the real fix, prompt nudge as secondary** —
   per the user's explicit choice. The matcher works regardless of what the model
   emits into `query`.
3. **Confirm's elapsed time measures since the click, not since the original
   message** — the alternative (time since the original ask) would conflate real
   system latency with however long the user spent thinking before clicking Confirm.
4. **No new UI for the unhandled-intent log** — the log is real (in-memory,
   timestamped, inspectable via `auditLogRef.current.all()`), covered by a test
   proving an entry is actually recorded, and documented for how a future screen
   would read it back. A dedicated backlog UI would be over-scoped for what was asked.

## Verification performed

- `pnpm typecheck` / `pnpm test` — 106 tests passing across the workspace (up from 97:
  core 69, web-demo 21, mobile-demo 16), typecheck clean across all 4 packages.
- New tests: `transactionSearch.test.ts` (7 tests, including the exact reported
  reproduction "what did I spend on drinking and eating" → matches Coffee Shop, and a
  fixture-integrity guard on the injected transaction), plus 2 new tests in
  `useAgentSession.navigation.test.tsx` (audit-log recording + generic message text on
  the null-mapped path; `elapsedMs` present on agent messages and absent on user
  messages).
- **Live-verified in Chrome via CDP**: typed "drinking and eating" into the real
  Transactions screen search box and confirmed only the Coffee Shop row (tagged
  "Food Drink") remained after filtering — the exact scenario originally reported,
  now fixed and visually confirmed, not just asserted in a unit test. Also rendered
  the `.elapsed-badge` with the real theme/agent CSS applied to confirm it matches the
  existing badge visual language.
- **Not independently re-reproduced live**: the unhandled-intent chat message and the
  full LLM-driven elapsed-time values on a real model response — both require a real
  WebGPU-backed chat round-trip, unavailable in headless Chrome, same category of gap
  documented throughout every prior LLM-dependent phase. Verified at the unit-test
  level (mocked `parseIntent`) instead.
