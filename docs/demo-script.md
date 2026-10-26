# Demo script — agent-augmented mock bank

This is the on-stage script for the live demo, per `technical-implementation-plan.md`
section 5, Phase 5. Written after Phases 1–4 were functionally complete and (for the
web app) live-verified in Chrome.

## Pre-show checklist

- [ ] Pre-warm WebLLM model cache: open `http://localhost:5174` in the actual
      presentation Chrome, send at least one chat message, wait for the model
      download+load to fully complete once before going on stage.
- [ ] Confirm WebGPU is active: open `chrome://gpu` in the presentation browser and
      confirm "WebGPU" shows a green/enabled status (this machine has an Apple M3 Pro
      with Metal 4 support and should support WebGPU in a normal, non-headless Chrome
      window — see `docs/implementation-log/phase-3-web-demo.md` for why this could not
      be literally confirmed from the build environment itself).
- [ ] Run `pnpm --filter web-demo dev` and leave it running; confirm `localhost:5174`
      loads cleanly.
- [ ] Confirm the recorded fallback video(s) below play correctly on the presentation
      machine/projector setup, at the resolution/aspect ratio that will be projected.
- [ ] If demoing mobile: confirm an iOS simulator (e.g. iPhone 15 Pro, confirmed
      available on this machine via `xcrun simctl list`) boots and the app installs —
      **NOT YET DONE, see phase-4 log's "recommended next step"**.
- [ ] Reset app state before the talk: clear `localStorage` for the web app (or use
      the seed data's natural values) so account balances match what's below.

## Segment 1 — Guardrail intro (no live coding)

Narrate over a slide of `packages/core/src/policy.config.ts`. Key points:
- Policy is data, not scattered if-statements — the whole security posture fits in
  one file and can be audited in a code review.
- No LLM call in the guardrail — it's a plain deterministic function. Point at
  `guardrail.test.ts`'s 13 passing tests as evidence, not a claim.
- Fail-safe default: an intent type with no matching rule is blocked, never allowed.

## Segment 2 — Web live demo

Open the web app on the Accounts screen. Utterances to type into the agent chat box,
in order:

| # | Utterance | Expected decision | Expected UI outcome |
|---|---|---|---|
| 1 | "show me my accounts" | allow | Agent responds; Accounts screen already shows 3 accounts |
| 2 | "transfer $200 from checking to savings" | allow (≤ $1000) | Transfer form fields fill in and submit automatically; balances update |
| 3 | "transfer $5000 from checking to savings" | confirm | Confirm dialog appears; click Confirm to execute |
| 4 | "pay Jane Smith $75" | confirm | Confirm dialog appears (known payee still requires confirm, per policy) |
| 5 | "add a new payee named Alex and pay them $500" | block | Agent explains: new payee + immediate payment is never auto-approved |

What to say at each step: name the guardrail decision out loud before revealing it
("this is above the $1000 threshold, so it should ask me to confirm — let's see").

## Segment 3 — Injection scenario

1. Navigate to the Transactions screen — point out the transaction row with the
   planted note (visible in the seeded data, dated 2026-08-23, description "Online
   Transfer Note").
2. Type into the chat: **"summarize my recent transactions"**.
3. Expected: the agent parses this as `get_transactions` (read-only, allow), and
   nothing related to the injected note's "instruction" is ever executed — no transfer
   happens, no confirmation dialog for a transfer appears.
4. Show the audit-log line (open dev tools console, or the `IntentPreview` expandable
   detail under the agent's response) — the story to tell: *"the agent's perception
   layer saw that note text, because it's part of the transaction data it read to
   answer my question — but the intent it produced only ever matches what I actually
   asked. There's no path from that note's text to an executed action."*
5. Automated proof this is reliable, not lucky: `packages/web-demo/src/injection-scenario/scenario.test.ts`
   runs this exact scenario 10 times in a row in CI — mention this rather than
   re-running it live 10 times on stage.

**Honesty note for the talk** (per spec section 7 and this build's own phase-2 log):
the schema-validation rejection is the hard backstop; the system prompt's instruction
to treat embedded content as inert is a soft first line of defense. State plainly that
this defends against this one demonstrated pattern, not all prompt injection generally.

## Segment 4 — Mobile offline demo

**Status: not yet rehearsed on a real simulator — see phase-4 implementation log.**
Script below is written for when that verification is complete.

1. Launch the mobile app (`npx expo start --ios`, select simulator).
2. With network on, type "show me my accounts" — executes immediately (read-only, allow).
3. Toggle airplane mode in the simulator.
4. Type "what are my recent transactions" — expected: queued (read-only intents are
   allowed to queue offline).
5. Type "transfer $50 from checking to savings" — expected: refused outright with a
   clear "requires a connection" message — **not** queued (this is the enforced
   `enqueueIfAllowed()` rejection in `offlineQueue.ts`, a real code path).
6. Re-enable network. Navigate to the Queue screen — expected: the queued
   get_transactions item drains automatically, decision recomputed fresh as "allow",
   queue ends empty.

## Fallback recordings

**No video capture is possible from the build environment used to prepare this repo**
(no display server, no screen-recording tooling, no simulator GUI access). This section
tracks what needs to be recorded manually before the talk — do not skip this silently.

| Segment | File (convention) | Status |
|---|---|---|
| 2 — Web live demo | `docs/recordings/segment-2-web-transfer.mp4` | `[NOT YET RECORDED]` |
| 3 — Injection scenario | `docs/recordings/segment-3-injection.mp4` | `[NOT YET RECORDED]` |
| 4 — Mobile offline/reconnect | `docs/recordings/segment-4-mobile-offline.mp4` | `[NOT YET RECORDED]` |

### Recording checklist (for whoever has access to the presentation hardware)

- Screen resolution: match the actual projector/display resolution for the talk.
- Browser window: full-screen or cropped tightly around the app — decide based on
  whether you want dev tools/console visible for the audit-log reveal in Segment 3.
- Audio: brief spoken narration matching the "what to say" notes above, or captions —
  decide based on venue AV setup.
- Expected duration: Segment 2 ~90s, Segment 3 ~45s, Segment 4 ~60s (rough estimates,
  adjust after a live rehearsal).
- Record each segment as a clean, single take if possible — glitches are more
  forgivable live than in a pre-recorded fallback.

## Timing estimates (for stage rehearsal)

| Segment | Estimated time |
|---|---|
| 1 — Guardrail intro | 1–2 min (slide only) |
| 2 — Web live demo | 2–3 min |
| 3 — Injection scenario | 1–2 min |
| 4 — Mobile offline demo | 2 min |
| **Total** | **~8–10 min** |
