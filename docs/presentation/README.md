# Talk deck: The agent in the browser tab

Open `index.html` in Chrome. It works offline: reveal.js 5.2.1 is vendored in
`vendor/reveal/` (MIT), and the demo GIFs are in `media/`. Only the Google Fonts
load from the network; without it the deck falls back to system fonts.

Keys: arrows to move, `S` for speaker notes (every slide has notes), `F` for
fullscreen, `Esc` for the slide overview.

## Where the numbers come from

Every figure is computed from `evidence/eval.jsonl` with the scorer in
`packages/core/src/eval/scoring.ts`, the same way `evidence/REPORT.md` is built
(`pnpm evidence:report`). The chart data is the `DATA` object at the bottom of
`index.html`. If you rerun the benchmark, update it from the new report.

## Demo recordings (`media/`)

Recorded from the real app with the real model (Qwen2.5-1.5B on WebGPU), driven
over the Chrome DevTools protocol at 1280×800 and encoded at 960×600:

| File | What it shows |
|---|---|
| `demo-1-transfer.gif` | "move 50 from everyday checking to savings", then "show me my accounts" |
| `demo-2-clarify-confirm.gif` | "pay my landlord" gets a question; "pay my landlord 50" needs a confirmation click |
| `demo-3-attack.gif` | two injection attempts; nothing executes and the balances stay the same |
| `demo-4-architecture.gif` | the live architecture view walking "send jane 35 bucks" through the pipeline |
