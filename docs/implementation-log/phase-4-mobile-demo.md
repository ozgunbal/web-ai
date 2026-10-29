# Phase 4 — Mobile adapter

Status: **built, fully unit-tested, and Metro-bundle-verified (bundler successfully
resolves and packages the whole app, 704 modules). Actual simulator boot/visual
verification NOT performed this pass, per the user's explicit instruction that mobile
simulator verification is a follow-up.**

## What was built

- `packages/mobile-demo/` scaffolded via `npx create-expo-app@latest --template
  blank-typescript` (accepted whatever SDK/RN version it resolved: Expo ~57.0.18,
  React Native 0.86.3, React 19.2.3 — independent from web-demo's React 18, which is
  fine since they're separate workspace members with no shared React tree).
- `src/agent/slotExtractor.ts` — keyword/slot-based parser (NOT a real LLM, per spec's
  own scope-down in Section 7). Outputs the same core `Intent` type as the web parser.
- `src/agent/offlineQueue.ts` — AsyncStorage-backed array queue. `enqueueIfAllowed()`
  rejects any intent with `riskTierForIntent(type) !== "read_only"` — a real enforced
  code path, not just UI copy, per spec 4.4.
- `src/agent/useNetworkStatus.ts` — NetInfo wrapper hook.
- `src/agent/reconnectDrain.ts` — drains the queue back through `evaluateIntent()`
  fresh (not a cached/bypassed decision) on reconnect, FIFO order.
- `src/app/HomeScreen.tsx`, `src/app/QueueScreen.tsx` — 2 minimal screens.
- `src/mock-data/accounts.ts` — mirrors web-demo's seed IDs for cross-demo consistency.
- Tests: `slotExtractor.test.ts` (8 tests), `offlineQueue.test.ts` (4 tests),
  `reconnectDrain.test.ts` (4 tests) — 16 tests total, using `jest-expo` preset with
  the standard documented AsyncStorage Jest mock.

## Verification actually performed (exceeded original plan's expectations)

1. **`pnpm test`** (Jest via jest-expo) — 16/16 passing, using mocked
   AsyncStorage/NetInfo per their own documented test integration patterns.
2. **`pnpm typecheck`** — clean.
3. **`npx expo-doctor`** — 21/21 checks passing (after correcting native module
   versions, see deviation #2 below).
4. **`npx expo export --platform ios`** — this is beyond what the approved plan
   expected to be achievable ("cannot run simulator... build achievable"): Metro
   successfully bundled the entire app end-to-end — 704 modules resolved, including
   `@web-ai/core`'s guardrail/schema/policy code and all native module imports
   (NetInfo, AsyncStorage) — producing a working `.hbc` bundle (2.1MB). This is strong
   evidence the app would run correctly on a real simulator/device, without having
   actually launched one.

## Decisions made / deviations from spec

1. **Removed all `.js` extensions from relative imports across `packages/core/src`.**
   The original phase-1 code used `import ... from "./schema/intent.js"` (valid
   TS-with-`.js`-extension ESM style, needed only if `core` were compiled with `tsc`
   to real `.js` output). Since `core` is consumed as raw TS source directly by every
   workspace member (Vite, Vitest, Jest, **and Metro**), this `.js`-suffixed style
   broke both Jest (`Cannot find module './schema/intent.js'`) and Metro
   (`Unable to resolve module ./schema/intent.js`) — both resolve relative imports
   against the actual `.ts` file, not a `.js` sibling that doesn't exist on disk.
   Fixed by stripping all `.js` suffixes; re-verified all 62 tests + both bundlers
   (Vite/Rollup and Metro) still resolve correctly afterward.
2. **Corrected native module versions via `npx expo install`.** Initial hand-picked
   versions (`@react-native-community/netinfo@^11.4.1`,
   `@react-native-async-storage/async-storage@^1.24.0`) failed `expo-doctor`'s SDK
   compatibility check (SDK 57 expects netinfo 12.0.1 and async-storage 2.2.0).
   Re-ran `expo install` to let Expo's CLI resolve the correct versions, per the
   plan's own instruction not to hand-pin these. Re-ran tests after the async-storage
   major version bump (1.x → 2.x) — all still passing.
3. **Added `jest.setup.js`** with the async-storage library's own documented Jest
   mock (`@react-native-async-storage/async-storage/jest/async-storage-mock`) — not
   mentioned in spec, but required for AsyncStorage-backed code to be testable at all
   under Jest (its real native module is null outside a real app runtime).
4. **Reconnect-drain UX decision** (plan's own instruction: "decide and document"):
   `allow` decisions execute immediately and leave the queue; `confirm` decisions are
   retained in the queue until the user acts on them (never silently dropped); `block`
   decisions are dropped. Implemented exactly this way in `reconnectDrain.ts`.
5. **Removed auto-generated `AGENTS.md`/`CLAUDE.md`** that `create-expo-app` scaffolded
   by default — not relevant to this project's own documentation structure.

## Test results (actual)

```
pnpm --filter mobile-demo test        → PASS, 3 suites, 16 tests, 0 failed
pnpm --filter mobile-demo typecheck   → PASS, no errors
npx expo-doctor                        → 21/21 checks passed
npx expo export --platform ios         → Bundled successfully, 704 modules, 2.1MB .hbc
```

## Known gaps / unverified items (explicitly deferred per user instruction)

- **No simulator/device was actually booted.** `expo start` was not run interactively;
  no visual rendering, touch interaction, or real OS-level airplane-mode toggle was
  observed. iOS simulators ARE present on this machine (`xcrun simctl list` confirmed
  iPhone 15/15 Pro/15 Pro Max, iOS 17.5) — this is a deliberate scope decision for this
  pass, not an environment blocker, and is tracked here as the explicit next step.
- **Real NetInfo OS-level network transitions** (actual airplane-mode toggle behavior)
  — only the NetInfo API surface was exercised indirectly via the app's `useNetworkStatus`
  hook design; no real device/simulator network state change was observed.
- **Visual/UX polish of the two mobile screens** — functional only, no design pass.

**Recommended next step**: `npx expo start --ios`, select the iPhone 15 Pro simulator
already available on this machine, and manually verify: (a) both screens render and
are tappable, (b) toggling the simulator's network connectivity (via `xcrun simctl
status_bar` or the Simulator's Settings app) changes `isOnline` and correspondingly
changes queue-vs-execute behavior, (c) reconnecting drains the queue as designed.
