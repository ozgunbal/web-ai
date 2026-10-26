# Phase 5 — Demo script + recordings

Status: **script written and cross-checked against the actually-built app's real
utterances/policy rules. Recordings NOT captured — tracked as an explicit outstanding
manual task, not silently skipped.**

## What was built

- `docs/demo-script.md`: pre-show checklist, 4 segments (guardrail intro, web live
  demo, injection scenario, mobile offline demo) with exact utterances, expected
  guardrail decisions, and expected UI outcomes — cross-checked against the real
  `POLICY_RULES` in `packages/core/src/policy.config.ts` and the real seeded mock data
  (account names, balances, payee name) so every utterance in the script would
  actually produce the stated decision if typed into the real app.
- Fallback-recording section with file-naming convention and a recording checklist,
  explicitly marked `[NOT YET RECORDED]` per file rather than faked.
- Timing estimates per segment.

## Decisions made

1. **Segment 4 (mobile) is explicitly marked "not yet rehearsed on a real simulator"**
   in the script itself — consistent with phase-4's own gap note. The script is
   written as if that verification will happen, but is honest that it hasn't yet.
2. **No stub/placeholder video files were created.** Per the plan's own instruction
   ("do NOT create empty/fake video files"), the recordings table lists intended file
   paths with a clear `[NOT YET RECORDED]` status and a checklist for whoever performs
   the recording on real presentation hardware.

## Test results

Not applicable — this phase produces documentation, not code. The script's utterances
were manually cross-checked against `policy.config.ts` and the live-verified web app
from Phase 3 (e.g. utterance amounts were chosen specifically to land on both sides of
the $1000 allow/confirm threshold, matching `internal-transfer-small-amount` /
`internal-transfer-large-amount`).

## Known gaps / unverified items

- **No video recordings exist.** This requires an actual presentation-machine session
  with screen-capture tooling, not available in this build environment.
- **Segment 4's mobile steps are unrehearsed** — depends on the Phase 4 follow-up
  (simulator boot + manual verification).
- **Segment 2/3's exact timing estimates are rough guesses**, not measured against a
  real full run-through with a loaded WebLLM model (which adds real latency per
  message not accounted for in the "~90s" estimate) — should be re-timed once a real
  bake-off (phase-2 gap) picks a final model and its typical response latency is known.
