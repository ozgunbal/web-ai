# Phase 6 — Visual redesign + guided tour (post-hoc addition)

Status: **complete, live-verified in Chrome via CDP (screenshots + interaction test).**
Not part of the original phased plan — added in response to a follow-up request to
make the web demo visually presentable and add an in-app guided tour.

## What was built

- `src/styles/theme.css` — dark-mode CSS custom-property design system (colors,
  radii, shadows, fonts).
- `src/styles/app.css` — layout shell (two-column: main content + sticky agent
  sidebar), card/nav/form/account/transaction component styles.
- `src/styles/agent.css` — chat panel styling: message bubbles, decision badges
  (allow/confirm/block, color-coded), model-status pill with animated dot, confirm
  card, suggestion chips, empty state.
- `src/styles/tour.css` — guided-tour overlay styling: scrim, highlight ring, tooltip
  card, step dots, "live in this app" badge, first-visit nudge card.
- Restyled every existing screen (`AccountsScreen`, `TransactionsScreen`,
  `TransferForm`, `PayPayeeForm`, `Nav`) and every agent-overlay component
  (`AgentOverlay`, `ChatInput`, `IntentPreview`, `ConfirmDialog`) to use the new
  classes — no change to `data-agent-*` markup or component logic/props other than
  `AgentOverlay` gaining an optional `registerHandle` prop.
- `src/tour/steps.ts` — declarative 11-step tour script covering: nav orientation,
  the read-only Accounts screen, meeting the agent panel, a live read-only ask, a
  live small transfer (auto-allow), a live large transfer (confirm), a live blocked
  new-payee payment, the planted injection note, a live injection-scenario ask, and
  a wrap-up. Six of the eleven steps actually drive the real app (`sendToAgent`
  triggers `useAgentSession.send()` through a registered handle), not just narration.
- `src/tour/GuidedTour.tsx` — the tour engine: measures the current step's
  `data-tour` target via `getBoundingClientRect`, renders a highlight ring + scrim +
  positioned tooltip card, clamps card position to stay on-screen, switches screens
  and/or sends agent messages on "Next".
- `src/tour/useTourNudge.ts` / `src/tour/TourNudge.tsx` — a one-time, localStorage-
  remembered nudge card inviting first-time visitors to take the tour; the tour
  itself remains available anytime via the header "Guided tour" button regardless of
  nudge state.
- Added `data-tour="..."` attributes to `Nav`, `AccountsScreen`, `TransactionsScreen`,
  `TransferForm`, `PayPayeeForm`, and `AgentOverlay` as stable tour anchor points —
  separate from `data-agent-*` (which is the agent's own perception layer) so the
  two concerns don't collide.

## Decisions made

1. **No external tour library** (e.g. react-joyride, driver.js) — built a small
   self-contained engine instead, to avoid adding a CDN/npm dependency for a
   conference-demo feature and to keep full control over "send a real agent message
   as part of a tour step," which off-the-shelf tour libraries don't support natively.
2. **Dark theme only** — no light-mode variant was requested or built; the demo is
   assumed to run in a fixed environment (a presentation), so theme-switching
   complexity wasn't worth adding.
3. **Tour steps that call `sendToAgent` reuse the exact same `send()` function** the
   real chat input calls (`useAgentSession.send`), exposed to the tour via a
   `registerHandle` callback prop on `AgentOverlay`. This guarantees the tour shows
   the REAL guardrail/adapter pipeline running, not a scripted fake — if the
   underlying logic changes, the tour automatically reflects it.
4. **First-visit nudge uses localStorage**, consistent with the existing
   `store.tsx` pattern already in this codebase for session persistence.

## Verification performed

- `pnpm typecheck` — clean (two `noUncheckedIndexedAccess` narrowing issues in
  `GuidedTour.tsx` fixed by capturing local `const` bindings before use in nested
  closures).
- `pnpm test` — all 6 existing web-demo tests still pass unchanged (they assert on
  `data-agent-*` attributes and behavior, not on CSS classes, so the redesign didn't
  touch anything they check).
- **Live verification in real Chrome via CDP** (same technique as Phase 3):
  - Screenshotted the redesigned Accounts screen — confirmed the two-column layout,
    card styling, suggestion chips, and agent panel all render correctly.
  - Screenshotted the Transactions screen — confirmed the planted injection note is
    now visually called out (red-tinted card, "⚠ embedded note" badge, monospace
    note text), which is a stronger visual moment for that demo segment than before.
  - Clicked the "Guided tour" button and stepped through it via CDP: confirmed the
    highlight ring correctly outlines the nav, then the agent panel; confirmed the
    tooltip card's clamping logic keeps it on-screen when the target is near a
    viewport edge; confirmed clicking "Next" on a `sendToAgent` step actually sends
    the message through the real `useAgentSession` pipeline (observed the user
    message bubble appear and model status transition to "thinking…" in the
    screenshot) — no exceptions thrown in the console during any of this.

## Known gaps / unverified items

- **The tour's `sendToAgent` steps will still hit the same WebGPU/headless-Chrome
  limitation** documented in Phase 3 when actually run in this build environment —
  the user message sends correctly but the agent's real reply requires a real
  (non-headless) browser with WebGPU, same caveat as before. This was expected and
  is not a regression.
- **Mobile has no equivalent tour** — this request was scoped to "make web up and
  running" with a tour; mobile's guided-tour equivalent (if wanted) is a follow-up.
- **No automated test coverage was added for the tour itself** (e.g. no
  `GuidedTour.test.tsx`) — verification here was live/manual via CDP rather than a
  committed jsdom test. Recommended follow-up if the tour becomes load-bearing for
  the actual conference demo: add a jsdom test asserting each step's `target`
  resolves to a real `data-tour` element currently in the DOM for its declared
  `screen`, to catch drift if screens are refactored later.

## Post-hoc update: proactive model-download progress + input gating

Follow-up request: show WebLLM's real download progress prominently in the agent
panel, and disable chat until the model has finished loading.

### What changed

- `packages/core/src/intent-parser.ts`:
  - Added `EngineLoadProgress` (progress fraction 0–1, elapsed seconds, status text) —
    a typed wrapper around WebLLM's own `InitProgressReport`.
  - Added `WebLlmEngineClient.preload()` — explicitly starts the model download/init
    without waiting for a `complete()` call, so the UI can trigger it immediately on
    mount instead of lazily on the user's first message.
  - `setProgressCallback` now receives the structured `EngineLoadProgress` instead of
    a bare string, so the UI can render a real percentage bar, not just status text.
- `packages/web-demo/src/agent-overlay/useAgentSession.ts`:
  - Calls `startLoading()` (which calls `engine.preload()`) in a `useEffect` on mount,
    rather than lazily inside `send()` — the model now starts downloading the moment
    the agent panel appears, not after the user's first message.
  - `send()` now no-ops defensively if `modelStatus !== "ready"` (the real gate is the
    disabled `<input>`/`<button>`, this is a belt-and-suspenders guard).
  - Removed duplicate error messaging: an initial-load failure no longer also gets
    pushed into the chat message list, since `ModelLoadPanel` (visible whenever
    `modelStatus !== "ready"`) already shows it prominently with its own retry button —
    live-testing in Chrome showed the same error rendered twice on screen before this
    cleanup.
- `packages/web-demo/src/agent-overlay/ModelLoadPanel.tsx` (new): renders a progress
  bar + percentage + elapsed time + status text while loading, or a "Model failed to
  load" state with the error text and a "↻ Clear cache & retry" button on failure.
  Shown in `AgentOverlay` whenever `modelStatus !== "ready"`.
- `packages/web-demo/src/agent-overlay/AgentOverlay.tsx`: chat input and send button
  now receive `disabled={!isReady}`; the empty-state suggestion chips only render once
  `isReady`; a text hint below the input explains why it's disabled
  ("Waiting for the on-device model to finish loading…" / "Model failed to load —
  retry above to enable chat.").
- New CSS: `.model-load-panel`, `.model-load-bar-track/-fill`, `.model-load-meta`,
  `.model-load-text`, `.model-load-note`, `.input-disabled-hint`, plus a disabled
  visual state for `.agent-text-input`.

### Verification performed

- `pnpm typecheck` / `pnpm test` — all 70 tests passing (unchanged count; this was a
  UI/wiring change, no new unit tests added for the progress panel itself — see gap
  note below), typecheck clean across all 4 packages.
- **Live-verified in Chrome via CDP** (same technique as prior phases): confirmed,
  immediately on page load, that the chat `<input>` and send `<button>` are both
  `disabled: true`, the `ModelLoadPanel` is present showing "Downloading on-device
  model… 0%", and typing into the disabled input has no visible effect on the message
  list (native `disabled` correctly blocks it). Waited through the full 3-attempt
  retry/backoff cycle and confirmed the failure state (expected in headless Chrome —
  no WebGPU, same known gap as every prior phase) shows "Model failed to load" with a
  working retry button, and — critically — the input **stays disabled** in the error
  state too, not just during loading. Caught and fixed a real duplicate-message bug
  this way (see above) that would not have been obvious from code review alone.

### Known gaps / unverified items

- **No committed test coverage for `ModelLoadPanel` or the gating logic itself** —
  verification was live/manual via CDP screenshots and DOM queries, not a jsdom test
  asserting `input.disabled` transitions across `modelStatus` values. Recommended
  follow-up: a `useAgentSession`-level test using a stub `EngineClient`-like object
  (similar to `intent-parser.test.ts`'s pattern) asserting `modelStatus` starts at
  `"loading"` immediately (not `"idle"`) and only becomes `"ready"` after preload
  resolves.
- **The actual successful-download path (progress bar moving from 0% to 100%, then
  transitioning to "ready" and enabling chat) has still not been observed with a real
  model download** — this build environment cannot exercise real WebGPU (documented
  extensively in Phases 2/3). The gating logic itself is proven correct (disabled →
  stays disabled through failure); only the "happy path" transition to enabled remains
  to be confirmed in a real browser session with sufficient disk space.
