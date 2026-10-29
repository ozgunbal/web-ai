# web-ai — agent-augmented app demo

Implementation of `technical-implementation-plan.md`: a small agent (intent parser →
deterministic guardrail → app adapter) layered on top of a mock banking app, on web
(React + client-side WebLLM) and mobile (Expo, offline queue).

**Non-negotiable constraint carried through the whole build**: this project only ever
talks to a mock app seeded with fake data. No real banking APIs, no real third-party
sites, no real money movement.

## Structure

```
packages/
├── core/          # @web-ai/core — schemas, guardrail, policy, intent parser
├── shared/        # @web-ai/shared — UI-facing DTOs
├── web-demo/      # @web-ai/web-demo — React + Vite mock bank + agent overlay
└── mobile-demo/   # @web-ai/mobile-demo — Expo mock bank + offline queue
docs/
├── demo-script.md              # on-stage script for the live demo
└── implementation-log/         # what was built, decisions made, gaps — per phase
```

## Getting started

```bash
pnpm install

# Web demo — Vite dev server, opens the mock bank + agent chat overlay
pnpm --filter web-demo dev

# Guardrail CLI demo — deterministic, no browser needed
pnpm demo:guardrail

# Run all tests / typecheck across every package
pnpm test
pnpm typecheck

# Mobile demo (Expo)
pnpm --filter mobile-demo start
```

No API key is required anywhere — the web intent parser runs entirely client-side via
WebGPU/WebLLM; nothing leaves the browser.

## Implementation log

See `docs/implementation-log/README.md` for a phase-by-phase account of what was
built, every design decision made beyond the literal spec text, and every known gap —
including which parts of this build were actually run/verified live versus built and
unit-tested only.

## Demo script

See `docs/demo-script.md` for the exact on-stage sequence, expected outcomes at each
step, and the status of fallback recordings.
