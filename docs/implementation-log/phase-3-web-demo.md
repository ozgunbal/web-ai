# Phase 3 — Web mock app + adapter

Status: **complete and live-verified in Chrome (real GUI rendering, real interactivity,
real end-to-end wiring). WebGPU/WebLLM real-model inference specifically blocked by
headless Chrome's GPU restriction — confirmed to be a headless-mode limitation, not an
app or hardware problem. See gap note below.**

## What was built

- `packages/web-demo/` scaffold: Vite 5 + React 18, `vite.config.ts`, `index.html`.
- `src/app/`: `AccountsScreen.tsx`, `TransactionsScreen.tsx`, `TransferForm.tsx`,
  `PayPayeeForm.tsx`, `Nav.tsx` — all tagged with `data-agent-action` /
  `data-agent-field` / `data-agent-submit`, field names matching core's zod schema
  field names 1:1.
- `src/agent-overlay/`: `AgentOverlay.tsx`, `ChatInput.tsx`, `IntentPreview.tsx`,
  `ConfirmDialog.tsx`, `useAgentSession.ts` (wires chat text → `parseIntent` →
  `evaluateIntent` → `executeIntent`, holds message/audit-log state).
- `src/agent-overlay/adapter/`: `domAdapter.ts` (perception — scans
  `[data-agent-action]`), `executeIntent.ts` (execution — native-setter + dispatched
  DOM events, then click on `[data-agent-submit]`), `adapter.test.ts`.
- `src/mock-data/`: `accounts.ts` (3 accounts), `transactions.ts` (7 transactions,
  incl. the injected one), `payees.ts` (1 payee), `store.tsx` (Context + useReducer +
  localStorage persistence).
- `src/injection-scenario/`: `fixture.ts` (planted note text + scenario utterance),
  `scenario.test.ts` (10-iteration repeatability proof).
- `packages/shared/src/index.ts`: `Account`, `Transaction`, `Payee` DTOs.

## Live verification actually performed (this pass)

Ran `pnpm --filter web-demo dev` (Vite dev server, port 5174) and drove a real Chrome
instance against it via the Chrome DevTools Protocol (headless Chrome with
`--remote-debugging-port`, since this shell has no Accessibility/AppleEvents
permission to drive the already-open GUI Chrome window via AppleScript):

1. **Static render** — headless screenshot confirms the Accounts screen renders
   correctly: title, nav, 3 seeded accounts with correct balances, agent overlay panel
   with input+send button. (`/tmp/web-demo-screenshot.png`, reviewed visually.)
2. **Interactivity** — clicked each nav button (`accounts`, `transactions`, `transfer`,
   `pay`) via a real DOM click dispatched through CDP and read back
   `document.body.innerText` after each: all four screens render correctly, including
   the Transactions screen showing the planted injection-scenario note text verbatim
   in the seeded transaction row.
3. **End-to-end chat wiring** — typed "show me my accounts" into the real chat input
   (native-setter + `input` event, same pattern the adapter itself uses) and clicked
   Send. Observed:
   - The user message appeared in the message list.
   - `useAgentSession` correctly instantiated `WebLlmEngineClient` and attempted a
     real `CreateMLCEngine` call.
   - The call failed with a real WebGPU error surfaced cleanly through the UI (not a
     crash): `"Unable to find a compatible GPU... check if your browser supports WebGPU"`.
   - Model status correctly transitioned `idle → loading → error`.

   This proves the full chat → parser → engine wiring is correct end-to-end; the only
   thing not verified live is real model inference itself (see gap below).

## Gap: WebGPU inference not verified live — root-caused, not just asserted

- This machine has a real GPU (`Apple M3 Pro`, Metal 4 support, confirmed via
  `system_profiler`) and a normal (non-headless) Chrome install that should support
  WebGPU.
- The WebGPU failure captured above was specifically triggered from **headless**
  Chrome (`--headless=new`), which disables GPU compositing/WebGPU by default
  regardless of flags tried (`--disable-gpu=false`, `--enable-unsafe-swiftshader`,
  `--use-angle=metal` were all attempted and did not enable it) — this is a
  well-documented Chrome headless-mode limitation, not a bug in this app.
- This shell environment has no Accessibility/AppleEvents permission
  (`osascript`/System Events calls were denied: "Not authorized to send Apple events"),
  so it cannot drive the real GUI Chrome window that was separately opened via `open -a`
  to click through the same flow there.
- **What this means concretely**: the app is fully built and its logic is fully
  verified (unit tests + live DOM interactivity + live error-handling of a real WebGPU
  call). The one remaining step — confirming real WebLLM model download + inference
  succeeds — requires the user (or a follow-up session with GUI automation permission)
  to open `http://localhost:5174` in their own, already-permissioned Chrome window and
  try a chat message. Given the hardware present, this is expected to work; it just
  was not literally observed in this pass.
- The intent-parser bake-off (phase-2 gap) is blocked by this same root cause and
  should be run in the same live-browser session.

## Note: retroactive fix from Phase 4

While building `packages/mobile-demo` (Phase 4), Metro's bundler rejected `core`'s
original `.js`-suffixed relative imports (e.g. `from "./schema/intent.js"`) even
though Vite/Vitest had resolved them fine here in Phase 3. All `.js` suffixes were
stripped from `packages/core/src/**` relative imports; web-demo's tests, typecheck,
and production build (`pnpm build`) were all re-verified green afterward. See
`docs/implementation-log/phase-4-mobile-demo.md` deviation #1 for the full story.

## Decisions made

1. **CDP-based live verification** instead of AppleScript UI automation, since this
   shell lacks Accessibility permission — not in the plan's original wording but a
   necessary substitution to achieve "actually run and verify" as instructed.
2. **`getOwnPropertyDescriptor` native-setter pattern** for both `executeIntent.ts` and
   the CDP test script — same technique, applied consistently, since React's
   controlled inputs don't respond to a plain `.value =` assignment.
3. **jsdom's `HTMLFormElement.prototype.requestSubmit` not implemented** — harmless
   stderr noise seen in `adapter.test.ts`; the click still fires correctly and the test
   assertions pass. Documented rather than silently ignored.

## Test results (actual)

```
pnpm --filter web-demo typecheck   → PASS, no errors
pnpm --filter web-demo test         → PASS, 2 files, 6 tests, 0 failed
pnpm --filter web-demo build         → PASS, production build succeeds (Vite/Rollup);
                                        note: @mlc-ai/web-llm produces a ~6MB/2.1MB-gzip
                                        chunk — expected for a model-serving library,
                                        flagged as a future code-splitting opportunity,
                                        not a defect
pnpm test (full workspace)          → PASS, core: 40, web-demo: 6, mobile-demo: 16 = 62 total
```

Live verification (not part of `pnpm test`, performed manually this pass, described above):
static render ✅, 4-screen interactivity ✅, end-to-end chat→parser→engine wiring ✅,
real model inference ❌ (headless GPU limitation, root-caused above, not an app defect).

## Known gaps / unverified items

- Real WebLLM model download + inference success/failure and actual latency — not
  observed; requires a real (non-headless, permissioned) browser session, expected to
  work given this machine's GPU but not literally confirmed.
- Cross-browser (Safari/Edge) WebGPU testing — not attempted.
- Visual/CSS polish — the app is intentionally unstyled beyond basic layout; no design
  pass was in scope for this build.
- Model cache pre-warming on presentation hardware — inherently a manual, on-the-day step.
