# Phase 2 — Intent parser (WebLLM)

Status: **harness + retry logic built and unit-tested; real WebGPU bake-off numbers
NOT captured in this pass — see gap note below.**

## What was built

- `packages/core/src/intent-parser.ts`:
  - `EngineClient` interface — injectable so parser logic is testable without a browser.
  - `parseIntent(engine, userText)` — builds a system prompt instructing the model to
    output strict JSON matching one `Intent` shape and to treat any embedded
    instructions in non-user content as inert data; retries up to `MAX_RETRIES = 2`
    with a stricter follow-up prompt on parse failure; validates every attempt against
    the zod `Intent` schema and never attempts to coerce/fix malformed output.
  - `WebLlmEngineClient` — real implementation using `@mlc-ai/web-llm`'s
    `CreateMLCEngine` + `chat.completions.create({ response_format: { type: "json_object" } })`.
    Only reachable via `@web-ai/core/web` (not the mobile-safe `.` export).
- `packages/core/src/intent-parser.test.ts` — 7 tests against a stub engine: first-try
  success, JSON-in-markdown-fence extraction, retry-then-succeed, exhausted-retries
  failure, out-of-schema type rejection, missing-required-field rejection, and an
  injection-defense test (parser output matches the user's actual request, not
  injected content).
- `packages/core/src/intent-parser.bake.test.ts` — the bake-off harness itself
  (`runBakeOff`, `TEST_UTTERANCES` — 6 valid / 5 ambiguous / 5 adversarial utterances,
  `schemaAdherenceRate`), plus 3 self-tests proving the harness's own scoring logic is
  correct using deterministic stub engines.

## Real candidate model IDs (confirmed from the installed `@mlc-ai/web-llm@0.2.84` package)

Read directly from `webllm.prebuiltAppConfig.model_list` rather than guessed from memory,
per the plan's own instruction not to hardcode model IDs:

- Gemma candidates: `gemma-2-2b-it-q4f16_1-MLC`, `gemma3-1b-it-q4f16_1-MLC`, `gemma-2b-it-q4f16_1-MLC` (older Gemma 1)
- Qwen candidate: `Qwen2.5-1.5B-Instruct-q4f16_1-MLC`

Recommended starting pair for the real bake-off (smallest reasonable footprint per
model family): `gemma-2-2b-it-q4f16_1-MLC` vs `Qwen2.5-1.5B-Instruct-q4f16_1-MLC`.

## Decisions made

1. **Injectable `EngineClient` interface** — not specified in spec, but necessary to
   make any of the retry/validation/rejection logic testable at all without a browser.
2. **Bake-off harness file renamed** from spec's implied `intent-parser.baketest.ts` to
   `intent-parser.bake.test.ts` — Vitest's default `include` pattern only matches
   `*.test.ts` / `*.spec.ts`; the original name silently matched zero test files.
   `package.json`'s `test:intent-parser` script updated to match.
3. **Prompt explicitly instructs the model to treat non-user content as inert** — this
   is the actual mechanism behind the injection defense claimed in spec section 4.6;
   the schema-validation rejection is the hard backstop, the prompt instruction is a
   soft first line of defense worth stating honestly is "best effort, not guaranteed."

## Test results (actual)

```
pnpm --filter @web-ai/core test:intent-parser  → PASS, 1 file, 3 tests
pnpm --filter @web-ai/core test (full suite)    → PASS, 4 files, 40 tests, 0 failed
```

**Important:** the 3 bake-off self-tests above prove the harness's scoring/retry
counting logic is correct against deterministic stub engines returning always-valid
or always-invalid output. **They are not a measurement of any real model's
schema-adherence rate.**

## Known gaps / unverified items (this is the largest gap in the whole build)

- **Real WebGPU inference has not been run.** `CreateMLCEngine` requires a real
  browser with WebGPU; this environment can install and inspect the `@mlc-ai/web-llm`
  npm package (confirmed model IDs above) but cannot execute `engine.chat.completions.create()`
  against a real model from a Node/shell context.
- **The spec's Phase 2 acceptance criteria ("chosen model hits an acceptable
  schema-adherence rate... measured, not guessed") is NOT met yet.** No real number
  exists for either candidate model.
- **To close this gap**: open `packages/web-demo` in Chrome (Phase 3, done in this same
  pass — see phase-3 log) and either (a) temporarily wire `runBakeOff` +
  `WebLlmEngineClient` into a small on-page trigger/console call, or (b) build a
  dedicated `/bake-off` route in web-demo. This was not done as part of this pass
  because Phase 3's priority was getting the live end-to-end chat flow itself working
  and verified first; running the full 16-utterance bake-off against two separate
  multi-hundred-MB model downloads is a follow-up task, not completed here.
- **Model choice for the live demo is therefore provisional**, not yet validated:
  recommend defaulting to `gemma-2-2b-it-q4f16_1-MLC` for the initial live-chat
  verification in Phase 3 (Google tie-in per spec's stated preference), with the real
  bake-off and possible switch to Qwen2.5-1.5B-Instruct left as a follow-up.

## Post-hoc update: real-world failure diagnosed and model switched

After Phase 3/6 shipped, the user hit a real error trying the live chat in their own
Chrome window: `Could not reach the on-device model: NetworkError: Failed to execute
'add' on 'Cache': Cache.add() encountered a network error`.

**Root cause, actually diagnosed (not guessed):** the user's machine had only ~2.8GB
of free disk space (`df -h /`), and `gemma-2-2b-it-q4f16_1-MLC` requires ~1.9GB of
Cache Storage for its weight shards. Chrome's per-origin Storage quota is tied to
available disk space; a multi-GB `Cache.add()` write on a nearly-full disk is very
likely to hit that quota mid-download and throw exactly this `NetworkError`. CORS was
ruled out first by directly checking Hugging Face's response headers with an `Origin:
http://localhost:5173` header (`access-control-allow-origin` correctly reflects the
request's origin, so the config/shard fetches are not CORS-blocked).

**Fixes applied:**
1. **Switched the web app's model** from `gemma-2-2b-it-q4f16_1-MLC` (~1.9GB) to
   `gemma3-1b-it-q4f16_1-MLC` (~711MB) in `useAgentSession.ts` — still a genuine Gemma
   model, much smaller footprint, more likely to fit even on a nearly-full disk.
2. **Fixed a real bug**: `WebLlmEngineClient.getEngine()` cached the *rejected* promise
   from a failed load forever, so every retry (even a fresh message) replayed the same
   dead error until a full page reload. Now clears itself on failure so the next
   `send()` genuinely retries.
3. **Added a bounded automatic retry** (`LOAD_RETRY_ATTEMPTS = 2`) around the whole
   `CreateMLCEngine` call, since a single dropped connection mid-multi-GB-download can
   throw this same error even on a healthy connection.
4. **Added `checkStorageQuota()`** (`packages/core/src/intent-parser.ts`) using the
   Storage API's `navigator.storage.estimate()` — called proactively before the first
   real model load, warning the user in-chat if remaining quota looks too tight for the
   model's size, rather than only diagnosing after a failed multi-minute download.
5. **Added `clearWebLlmCache()`** and a "↻ Clear cache & retry" button surfaced directly
   under a failed message, plus a much more specific error message that names the
   likely causes in order of probability (quota, dropped connection, ad blocker/
   extension, corrupted partial download) and includes the last progress report text
   (which usually names the exact file that failed).
6. Added 7 new unit tests (`webllm-error-handling.test.ts`) covering `clearWebLlmCache`
   and `checkStorageQuota`'s branches (unavailable, insufficient, sufficient, and
   estimate() itself throwing) — all with mocked `caches`/`navigator.storage` globals,
   no real browser needed.

**Verification**: `pnpm test` — 69 tests passing across the workspace (up from 62),
typecheck clean. The actual fix (smaller model successfully downloading and running)
still requires the user's own browser session to confirm, since real WebGPU/Cache
Storage behavior remains unverifiable from this shell-only environment — same
category of gap as the rest of Phase 2/3, just with a much more specific, evidence-
based diagnosis behind it this time rather than a generic list of possible causes.

## Second post-hoc update: init-stage failures were invisible, now logged to console

The user reported a further, distinct symptom: the model could download successfully,
but then fail to *initialize* — and that failure produced only a generic user-facing
string, with no way to actually diagnose what went wrong. Investigating the code
confirmed this gap directly: `loadEngine()`'s catch block only ever built a summary
string via `describeWebLlmLoadError`; the raw `err` object — including its real
message, stack trace, and any `cause` — was discarded on every attempt, both
successful-retry attempts and the final one.

**Fixes applied** (`packages/core/src/intent-parser.ts`):
1. Added `logWebLlmLoadError()` — logs, via `console.group`/`console.error`, the raw
   error object, its stack trace, its `cause` (if present), the model ID, and the last
   progress report text received before the failure. Called on **every** retry
   attempt (not just the final one), so a transient first-attempt failure that then
   succeeds on retry is still visible in the console, and a persistent failure shows
   its error 3 times (once per attempt) rather than only the last.
2. `describeWebLlmLoadError()` now distinguishes **download-stage** failures (the
   existing `Cache.add()`/`NetworkError` pattern) from **init-stage** failures (a new
   pattern matching `webgpu|gpu|device|adapter|shader` in the error message) — the
   latter means the download itself succeeded and the WASM/WebGPU engine construction
   failed afterward, which needs different troubleshooting advice (check `chrome://gpu`,
   not disk space/network). Both branches now end with "Full error details were logged
   to the browser console" so the user knows to check there for the exact cause.
3. Added `packages/core/src/webllm-init-logging.test.ts` — 4 new tests using
   `vi.doMock("@mlc-ai/web-llm", ...)` to simulate `CreateMLCEngine` rejecting with an
   init-stage error, a download-stage error, and a sequence of per-attempt errors;
   asserts `console.group`/`console.error` are actually called with the raw error
   objects (not just message strings), the model ID, and that the two failure
   categories produce distinguishable user-facing messages. Uses `vi.useFakeTimers()` +
   manual `advanceTimersByTimeAsync` to avoid the real ~3s of retry backoff delay per test.

**Live verification**: ran the dev server and drove headless Chrome via CDP,
capturing real `Runtime.consoleAPICalled` events. Confirmed, with the real (unmodified)
`WebLlmEngineClient` hitting its actual "no WebGPU in headless Chrome" failure: 3
`console.group` calls (one per retry attempt, correctly labeled "attempt 1/3",
"2/3", "3/3"), each followed by 4 `console.error` lines (raw error, stack, model ID,
last progress) — exactly the diagnostic detail the user asked for, verified as real
console output in a real browser, not just asserted in a mocked test.

**Test results**: `pnpm test` — 74 tests passing across the workspace (up from 70),
typecheck clean across all 4 packages.

## Third post-hoc update: found and fixed the actual init-stage bug via the new logging

The new console logging immediately paid off: the user's very next real error was a
precisely diagnosable one, visible directly in the console thanks to the change above:

```
WindowSizeConfigurationError: Only one of context_window_size and sliding_window_size
can be positive. Got: context_window_size: 4096, sliding_window_size: 512
Consider modifying ModelRecord.overrides to set one of them to -1.
    at new LLMChatPipeline (...)
```

**Root cause, confirmed by fetching the model's real config**: `gemma3-1b-it-q4f16_1-MLC`'s
own `mlc-chat-config.json` (fetched directly from Hugging Face and inspected) sets
`context_window_size: 8192` and `sliding_window_size: 512` — both positive. WebLLM's
prebuilt model record for this model only overrides `context_window_size: 4096`,
leaving `sliding_window_size` at its config-shipped positive value. `LLMChatPipeline`
hard-rejects having both positive, per the error's own message. This is a real gap in
WebLLM's bundled model record for this specific model, not an environment or hardware
issue.

**Fix applied** (`packages/core/src/intent-parser.ts`): `CreateMLCEngine` accepts a
third `chatOpts` parameter (typed `ChatOptions`, i.e. `Partial<ChatConfig>`) that
overrides the model's own config per-call, without mutating the global
`prebuiltAppConfig`. Now passing `{ sliding_window_size: -1 }` there, exactly as the
error message itself suggests — forcing fixed-context-window truncation instead of
sliding-window attention, which is fine for this app's short single-turn prompts.

**Verification**:
- Added `webllm-init-logging.test.ts`'s `WindowSizeConfigurationError` test: asserts
  this specific error produces a distinct, precise user-facing message ("the model's
  own configuration is invalid," not the generic GPU/device message), and that the raw
  error is still logged.
- Added a new test asserting `CreateMLCEngine` is actually called with
  `{ sliding_window_size: -1 }` as its third argument — guards against this override
  being silently dropped in a future refactor (the previous tests only checked error
  *messages*, which wouldn't have caught a regression here since a missing override
  produces a different error, not a missing one).
- **Live-verified the fix in a real browser via CDP**: re-ran the same dev server
  against real (unmocked) `@mlc-ai/web-llm`, captured live console output, and
  confirmed the `WindowSizeConfigurationError` no longer appears — the load now fails
  purely on "Unable to find a compatible GPU" (the expected, unavoidable headless-
  Chrome limitation), meaning the fix has moved the failure point cleanly past the
  config-validation bug and into whatever WebGPU does next. This is the strongest
  verification available from this environment: the specific bug that was reported is
  provably gone, even though full "loads successfully end-to-end" verification still
  needs the user's own GPU-capable browser session.

**Test results**: `pnpm test` — 76 tests passing across the workspace (up from 74),
typecheck clean across all 4 packages.

## Fourth post-hoc update: model loaded successfully, then crashed on first real message

Progress: the `WindowSizeConfigurationError` fix above worked — the user's next
error confirmed the model finished loading and initializing, then crashed on the
first actual chat request:

```
BindingError: Cannot pass non-string to std::string
    at throwBindingError (...)
    at GrammarCompiler.CompileJSONSchema (...)
    at GrammarCompiler.compileJSONSchema (...)
```

**Root cause, confirmed by reading WebLLM's own runtime source** (not guessed): our
`complete()` call passed `response_format: { type: "json_object" }` with no `schema`
field. WebLLM's docstring for this option claims it just "guarantees valid JSON," but
its actual implementation (`packages/core/node_modules/@mlc-ai/web-llm/lib/index.js`,
the code path handling chat completion requests) unconditionally calls
`grammarCompiler.compileJSONSchema(responseFormat.schema)` whenever
`type === "json_object"` — there is no code path in this WebLLM version where
`json_object` mode skips schema compilation. Since `schema` was `undefined`, the C++
binding underneath (`GrammarCompiler.CompileJSONSchema`, compiled to WASM) rejected it
with `BindingError: Cannot pass non-string to std::string`. This is a real mismatch
between WebLLM's public API documentation and its actual behavior in v0.2.84 — not a
transient/environment issue.

**Decision (user consulted, chose the recommended option)**: rather than generating
and maintaining a JSON-schema string derived from the zod `Intent` union (which would
give WebLLM's own grammar-constrained decoding, but adds a new dependency and a schema
representation that must stay in sync with the zod schema across version changes),
`response_format` is now omitted entirely from the `complete()` call. The system
prompt's explicit "output strict JSON only" instruction, combined with `parseIntent`'s
existing zod validation + bounded retry loop, is already the real security boundary in
this design (per `parseIntent`'s own docstring: "this strict rejection is itself part
of the injection defense") — dropping `response_format` doesn't weaken that boundary,
it just removes a broken WebLLM feature that was never load-bearing for correctness.

**Fix applied** (`packages/core/src/intent-parser.ts`): removed
`response_format: { type: "json_object" }` from the `chat.completions.create()` call
in `WebLlmEngineClient.complete()`, with an inline comment explaining why (traces back
to this exact bug) so it isn't accidentally reintroduced later.

**Verification**:
- Confirmed via WebLLM's own source (`grammarConstrained` check gating the whole
  grammar-bitmask code path) that omitting `response_format` entirely — versus setting
  it to `undefined` or `{ type: "text" }` — results in NO grammar constraining being
  attempted at all, which is the correct, safe behavior.
- Added a new test (`webllm-init-logging.test.ts`, "WebLlmEngineClient.complete —
  response_format") asserting the real request object passed to
  `chat.completions.create()` never contains a `response_format` key — guards against
  this exact bug being reintroduced by a future change.
- **Not independently re-reproduced live in this environment**: this bug only
  manifests after a real, successful model load (real GPU/WebGPU required), which
  this shell-only build environment cannot exercise — same category of gap as the rest
  of Phase 2. The fix is verified at the source-code level against WebLLM's actual
  runtime behavior and by unit test, but the end-to-end "sends a real message
  successfully" path still needs the user's own browser session to confirm.

**Test results**: `pnpm test` — 77 tests passing across the workspace (up from 76),
typecheck clean across all 4 packages.

## Fifth post-hoc update: parseIntent's validation failures were a diagnostic dead end

With the `response_format` bug fixed, the model now actually responds — but the user's
next report was `"Model output did not validate against the Intent schema after
retries."` with, in their words, "no clue what's done in the middle." Reviewing
`parseIntent` confirmed the gap directly: `Intent.safeParse(candidate)`'s failure
branch never inspected `parsed.error` at all — the one piece of data that says
*which* field(s) failed and why was silently discarded on every failed attempt, for
every retry, with nothing surfaced anywhere.

**Fix applied** (`packages/core/src/intent-parser.ts`): `parseIntent` now wraps its
entire retry loop in `console.group`/`console.groupEnd` (one group per call, one
nested group per attempt) and logs, at each step:
- the exact prompt sent to the model (including which retry-attempt variant of the
  system prompt was used),
- the raw text the model returned,
- the JSON-extraction result (or a distinct warning if no JSON could be extracted at
  all, separate from "extracted but invalid"),
- on success: the validated Intent object,
- on failure: `parsed.error.issues` — zod's own array of `{ path, code, message }`
  objects naming exactly which field(s) were missing/wrong-typed and why,
- on final exhaustion: a `console.error` summary listing every raw output across all
  attempts, so a user can see the full sequence of what the model tried.

**Verification**:
- Added 4 new tests (`intent-parser.test.ts`, "parseIntent — console logging for
  debugging") asserting: prompt/raw-output/candidate/success are logged on a valid
  parse; the real zod issues array (with correct field paths) is logged on a schema
  validation failure; the final exhausted-attempts summary includes all raw outputs;
  a distinct warning fires when no JSON can be extracted at all (vs. JSON that parses
  but fails schema validation) — these are two different failure modes that now have
  two different log messages, not one generic one.
- Live-verified during a normal `pnpm test` run: the console output shown by Vitest for
  the pre-existing (now passing) tests is real, exercised output — visually confirmed
  it shows nested groups, the full prompt text, raw output, extracted candidate, and
  (for a deliberately-invalid stub response) the exact zod issues naming
  `fromAccountId`/`toAccountId`/`amount` as missing.
- **Confirmed the updated source is what Vite actually serves**: fetched
  `packages/core/src/intent-parser.ts` directly from the running dev server via its
  `@fs` passthrough and grepped for the new log strings — present, confirming the next
  real chat interaction in the user's browser will exercise this logging as written
  (not stale/cached). Could not reproduce the exact "model responds but the response
  fails validation" scenario live from this environment, since a real model response
  requires GPU access unavailable in headless Chrome — same category of gap as the
  rest of Phase 2, verified here via unit tests + confirming the served source instead.

**Test results**: `pnpm test` — 80 tests passing across the workspace (up from 77:
core 58, web-demo 6, mobile-demo 16), typecheck clean across all 4 packages.

## Sixth post-hoc update: the new logging immediately surfaced a real model-quality bug

With logging in place, the user's next report was the raw model output itself —
and it was a genuine, diagnosable failure: `gemma3-1b-it` degenerated into repeating
`` ```json `` (and similar fragments) for thousands of tokens without ever closing a
valid JSON object, alongside inventing out-of-schema fields (`"type": "accounts"`,
`account_number`) not present anywhere in our `Intent` schema or prompt. This is a
known failure mode for small quantized models generating under no decoding
constraints — which is exactly the state we left it in after removing
`response_format` (see the fourth update above): no `max_tokens` cap, default
temperature, and no repetition penalty, so a degenerate loop was free to run to the
model's full context length instead of stopping early.

**Fix applied** (`packages/core/src/intent-parser.ts`, `WebLlmEngineClient.complete()`):
added three real, documented `ChatCompletionRequest` parameters (unrelated to the
broken `response_format`/grammar-compiler path):
- `max_tokens: 200` — our JSON payloads are at most a few hundred characters; no
  legitimate answer needs anywhere near this, so it bounds the worst case tightly.
- `temperature: 0` — deterministic decoding, appropriate for a structured-output task
  rather than creative generation.
- `repetition_penalty: 1.3` — actively discourages the model from repeating the same
  token/phrase, directly targeting the observed `` ```json `` loop (WebLLM's own docs:
  values `>1.0` discourage repeated tokens).

Also added `truncateForLogging()` (2000-char cap) applied only to what gets printed to
`console.log`/`console.error` for raw model output — a degenerate response is still
useful to see the *start* of in the console, but printing tens of KB of repeated text
verbatim would flood/freeze DevTools. The full, untruncated text is still returned to
callers via `ParseFailure.rawOutputs` (unaffected — only the console copy is truncated).

**Verification**:
- Added a new test asserting `chat.completions.create()` actually receives
  `max_tokens`, `temperature: 0`, and `repetition_penalty > 1` in its request object —
  guards against these being silently dropped in a future refactor.
- Added 2 new tests in `intent-parser.test.ts`: one feeding a deliberately degenerate
  ~16KB repeated-string stub response through `parseIntent`, asserting the logged
  console output is shorter than the input and contains "truncated" — both for the
  per-attempt "Raw model output" log and the final "All attempts exhausted" summary;
  a second test asserting the value actually **returned** to the caller
  (`result.rawOutputs[0]`) is the full, untruncated string, confirming truncation only
  affects what's printed, not the data itself.
- Confirmed via the running dev server's `@fs` passthrough that the served
  `intent-parser.ts` source includes all three new parameters — the next real chat
  interaction will use them. Could not reproduce the exact degenerate-generation
  behavior live from this environment (requires a real model responding, which needs
  GPU access unavailable in headless Chrome) — same category of gap as the rest of
  Phase 2.

**Test results**: `pnpm test` — 83 tests passing across the workspace (up from 80:
core 61, web-demo 6, mobile-demo 16), typecheck clean across all 4 packages.

## Seventh post-hoc update: specific failure reasons + relaxed cosmetic schema strictness

With the generation params fixed, the model now responds quickly — but the user's
next report was a validation failure with, again, no visible reason ("Intent parsing
failed... no clue what's done in the middle"). This time the gap was different from
the earlier ones: the per-attempt zod issues WERE already being logged to console
(from the fifth update), but `ParseFailure.reason` — the string actually shown in the
agent's chat bubble, not just DevTools — was still the old generic "Model output did
not validate against the Intent schema after retries."

**User was consulted on two decisions, both accepted the recommended option**:
1. Surface the specific failure both in the chat message and in `ParseFailure.reason`
   (not console-only).
2. Relax the schema for two specific, safe, cosmetic small-model quirks — WITHOUT
   touching the actual security boundary.

**Fixes applied**:
- `packages/core/src/schema/intent.ts`:
  - `amountField = z.coerce.number().positive()` replaces `z.number().positive()` on
    every intent's `amount` field — tolerates `"200"` (string) the same as `200`
    (number), since small local models commonly emit numeric values as JSON strings.
    Coercion of a genuinely non-numeric string (e.g. `"abc"`) still fails, and
    zero/negative amounts still fail — this is purely a string-vs-number formatting
    tolerance, not a loosening of what counts as a valid amount.
  - `rawInputSummary: z.string().default("")` replaces the previously-required
    `z.string()` — small models frequently omit fields that aren't central to the
    action itself even when the prompt asks for them; this field is a "nice to have"
    audit-log paraphrase, not part of the security boundary (the closed intent-type
    enum and required action fields like `fromAccountId`/`payeeId` are untouched).
- `packages/core/src/intent-parser.ts`:
  - Added an `AttemptFailure` type tracking the LAST attempt's actual failure
    (`no_json_extracted` vs `schema_validation_failed` with the real zod issues
    array), carried across the retry loop.
  - Added `describeAttemptFailure()` turning that into a specific, actionable string —
    e.g. `"The model's JSON did not match the required action schema — fromAccountId:
    Invalid input: expected string, received undefined; amount: Invalid input:
    expected number, received NaN."` — used for BOTH the final console summary and
    `ParseFailure.reason`.
- `packages/web-demo/src/agent-overlay/useAgentSession.ts`: the chat message for a
  parse failure now shows `result.reason` directly (it's already a complete sentence)
  instead of wrapping it in a redundant "I couldn't parse that into a supported action
  (...)" preamble that read awkwardly once the reason itself became a full sentence.

**Verification**:
- Updated one existing schema test (`requires rawInputSummary on every intent` →
  `defaults rawInputSummary to an empty string when omitted`) to match the deliberate
  relaxation, and added 3 new schema tests: numeric-string amount coerces correctly,
  a genuinely non-numeric string still rejects, a negative numeric-string still
  rejects.
- Added 2 new `intent-parser.test.ts` tests: one asserting the exhausted-retries
  reason names "did not contain any recognizable JSON" when no JSON was ever
  extracted; one asserting the reason contains the actual field names
  (`fromAccountId`, `toAccountId`, `amount`) when JSON was extracted but failed
  validation — directly testing the exact gap reported.
- Confirmed via the running dev server's `@fs` passthrough that both the relaxed
  schema (`z.coerce.number()`, `rawInputSummary` default) and the new
  `describeAttemptFailure` logic are present in what's actually served.

**Test results**: `pnpm test` — 87 tests passing across the workspace (up from 83:
core 65, web-demo 6, mobile-demo 16), typecheck clean across all 4 packages.

## Eighth post-hoc update: with a real specific reason visible, the actual gap was model output quality

With `describeAttemptFailure` in place, the next real failure the user hit was, for the
first time, fully diagnosable from the reason string + raw output they pasted: `"The
model's response did not contain any recognizable JSON object"`, with the actual raw
output showing severely malformed text — an unterminated string mixing `{`/`[`, a
repeated "Output:" preamble, no `type` field anywhere, e.g.:

```
```json
{
"Account1234567890, 100.01
```

Output:
[
  "Account1234567890, 100.01
```

This is a genuine small-model output-quality/prompt problem, not a parsing-robustness
gap — no extraction strategy can recover text that was never valid JSON to begin with
(the string itself is unterminated). Two contributing causes were addressed:

1. **The system prompt gave the model a field-name list but no concrete example to
   imitate.** For a 1B-parameter model, this matters far more than for a large cloud
   model — few-shot examples measurably improve structured-output adherence in small
   models. Added one literal example JSON object per intent type directly in
   `SYSTEM_PROMPT`, and made the instruction explicitly forbid the exact failure modes
   observed ("no 'Output:' labels, no lists").
2. **`max_tokens: 200` (set in the sixth update) may have been too tight** for a model
   that front-loads prose before the actual JSON — genuinely truncating it mid-object
   (an unterminated string with no closing brace is consistent with hitting a token
   limit mid-generation, not with the model deciding to emit broken JSON). Raised to
   `max_tokens: 400` to give a chatty preamble room to still finish with a complete object.

**Fixes applied** (`packages/core/src/intent-parser.ts`):
- Rewrote `SYSTEM_PROMPT` to include one concrete example object per intent type.
- Rewrote the retry-attempt prompt (attempt 2+) to be more forceful and specific
  ("STOP... do not write 'Output:'... do not leave any string or bracket
  unterminated"), directly naming the failure patterns actually observed.
- Raised `max_tokens` from 200 to 400.
- Strengthened `extractJson()`: now tries every `` ```json ... ``` `` fenced block in
  the response in turn (not just the first), since a model can emit multiple candidate
  blocks and only one may be valid; the final fallback regex now also matches
  `[...]`-wrapped JSON, not just `{...}`, in case a model emits a bare array. Still
  makes NO attempt to repair/complete genuinely malformed JSON (no closing brace, no
  matching bracket) — per `parseIntent`'s own design principle, that must fail
  cleanly, not be coerced.

**Verification**:
- Added 2 new tests in `intent-parser.test.ts`: one confirming multiple fenced blocks
  are tried in order and the first genuinely-valid one wins; one reproducing the EXACT
  real-world failure text reported (unterminated string, mixed brackets, repeated
  "Output:" preamble) and asserting it fails cleanly with the correct
  "did not contain any recognizable JSON" reason, not a hang/throw/silent wrong answer.
- Confirmed via the running dev server's `@fs` passthrough that the new prompt
  (with examples), the raised `max_tokens: 400`, and the multi-fence extraction logic
  are all present in what's actually served.
- **Not independently re-reproduced live**: whether the new prompt/token-limit
  actually produces valid JSON more often for this specific model still requires the
  user's own browser session — this environment cannot run real inference (documented
  extensively throughout Phase 2). The changes are targeted directly at the exact
  failure text reported, which is the strongest evidence available without live
  re-verification.

**Test results**: `pnpm test` — 89 tests passing across the workspace (up from 87:
core 67, web-demo 6, mobile-demo 16), typecheck clean across all 4 packages.

## Ninth post-hoc update: the model was imitating our own prompt scaffolding

The prompt-example fix above didn't resolve it — the next real failure was
qualitatively different and more revealing: the model's raw output was pages of
`"User message:"` / `"User input:"` / `"User:"` repeated with slight variations of the
user's own text ("show me accounts"), never attempting to answer at all.

**Root cause, found by reading our own code, not guessing**: `parseIntent` built ONE
string like `` `${SYSTEM_PROMPT}\n\nUser message: ${userText}` `` and sent that whole
thing as a single `role: "user"` chat message. The model was seeing the literal text
`"User message: show me my accounts"` as CONTENT — not as a role separator — and,
because `gemma3-1b-it`'s own chat template (confirmed via its `mlc-chat-config.json`'s
`conv_template`) has no native system-role turn (system content is folded into the
first user turn), the model had no signal that "User message:" was our formatting
convention rather than something to imitate. It pattern-matched on that literal label
and degenerated into producing more variations of it instead of an answer.

**Fix applied**: this required changing the `EngineClient` interface itself, since the
bug was in how prompt and user text were combined before ever reaching WebLLM:
- `EngineClient.complete()` now takes `{ system: string; user: string }` instead of a
  single pre-concatenated `prompt: string`. `parseIntent` passes the user's raw text
  as `user` with NO added labels, ever — the retry-attempt's stricter correction
  instructions ("STOP. Your previous answer was invalid...") now live in `system`
  alongside the original instructions, not appended to the user's turn.
- `WebLlmEngineClient.complete()` sends these as two genuinely separate chat messages
  — `{ role: "system", content: system }` and `{ role: "user", content: user }` —
  letting WebLLM/the model's own chat template handle system-message folding correctly
  instead of us hand-rolling label text that the model then imitates.
- Updated console logging to show "System message sent to model:" and "User message
  sent to model:" separately, so this distinction is visible in the diagnostic output
  too.

**Verification**:
- Updated `StubEngine` (`intent-parser.test.ts`) to record every `{system, user}` pair
  it receives, and added a new test asserting the user field is EXACTLY the user's raw
  text with no "User message:"/"User input:" substrings — directly testing the
  regression.
- Added a new test in `webllm-init-logging.test.ts` asserting `WebLlmEngineClient`
  sends the real `chat.completions.create()` call with two distinct
  `{role, content}` entries (`system` then `user`), not one concatenated string.
- Fixed the two other `EngineClient` implementers that the interface change broke at
  compile time (`webllm-init-logging.test.ts`'s inline mocks, and
  `web-demo/src/injection-scenario/scenario.test.ts`'s `InjectionAwareStubEngine`) —
  all now correctly destructure `{ system, user }`.
- Confirmed via the running dev server's `@fs` passthrough that the real
  `WebLlmEngineClient.complete()` sends `{ role: "system", ... }` and
  `{ role: "user", ... }` as genuinely separate messages, not the old
  concatenated-string approach.
- **Not independently re-reproduced live**: whether this actually stops the model from
  echoing our prompt still requires the user's own browser session — this is the
  single most environment-dependent fix so far, since it depends entirely on how a
  specific chat template + small model responds to properly-separated roles, which
  cannot be exercised without real inference.

**Test results**: `pnpm test` — 91 tests passing across the workspace (up from 89:
core 69, web-demo 6, mobile-demo 16), typecheck clean across all 4 packages.

## Tenth post-hoc update: model switch after concluding gemma3-1b-it has a real capability ceiling

Despite fixing four distinct, real bugs in a row (window-size config, the broken
`response_format` grammar path, unbounded degenerate generation, and hand-rolled
prompt labels the model imitated instead of a real system role), `gemma3-1b-it` still
could not reliably produce valid JSON — the user's next report was, again, more
hallucinated/garbled output. At this point, further prompt engineering against the
same model was very unlikely to help: this reads as a genuine capability ceiling for a
1B-parameter, heavily quantized model on structured-output generation, not a fixable
bug.

**User was consulted directly** on how to proceed (switch model vs. add a
deterministic keyword-fallback safety net vs. both) and **chose to switch models**,
not add a fallback parser — so no fallback-parser work was done in this update.

**Model chosen: `Qwen2.5-1.5B-Instruct-q4f16_1-MLC`** (~1.63GB), replacing
`gemma3-1b-it-q4f16_1-MLC` (~711MB). Rationale, confirmed concretely before switching
(not assumed):
- Fetched Qwen2.5-1.5B's own `mlc-chat-config.json` and found `sliding_window_size:
  -1` already — the exact bug class that caused the `WindowSizeConfigurationError`
  with Gemma cannot occur here.
- Its `conv_template.name` is `"qwen2"` with a genuine ChatML-style system role
  (`<|im_start|>user`/`<|im_start|>assistant`, default `system_message: "You are a
  helpful assistant."`) — unlike Gemma's role-folding (no native system turn), which
  was the root cause of the "model imitates our own prompt labels" bug fixed in the
  previous update. Qwen's chat template should let our system/user role separation
  work as intended rather than fighting the model's own formatting assumptions.
- Disk space had also changed since the original downgrade decision: re-checked `df
  -h /` and found **7.9GB free** (up from the ~2.8GB that originally forced the
  downgrade to gemma3-1b) — comfortably enough for Qwen2.5-1.5B's ~1.63GB, still well
  under the ~1.9GB `gemma-2-2b-it` that failed outright on disk space originally.
- Confirmed both the model's config file and its WASM runtime library resolve with a
  real `200` over HTTPS (with the app's actual `Origin` header) before committing to
  the switch, avoiding a repeat of chasing a broken/unreachable URL.

**Fix applied**: `packages/web-demo/src/agent-overlay/useAgentSession.ts` —
`MODEL_ID` changed to `"Qwen2.5-1.5B-Instruct-q4f16_1-MLC"`,
`MODEL_APPROX_SIZE_MB` updated to `1630` (was `711`) so the proactive storage-quota
check (added in an earlier update) warns against the correct, larger footprint. No
other code changes were needed — all the intent-parser/prompt/logging fixes from the
previous nine updates are model-agnostic and apply unchanged.

**Verification**:
- `pnpm typecheck` / `pnpm test` — unaffected, still 91 tests passing (the model ID is
  a plain string constant, not exercised by any test — all existing coverage is against
  the `EngineClient` interface via stubs, which remains correct regardless of which
  real model backs `WebLlmEngineClient`).
- Confirmed via the running dev server's `@fs` passthrough that `MODEL_ID` is now
  `Qwen2.5-1.5B-Instruct-q4f16_1-MLC`.
- **Not independently re-reproduced live**: whether Qwen2.5-1.5B actually produces
  reliably valid JSON for this app's prompts still requires the user's own browser
  session — this remains the single largest unverified gap across all ten updates in
  this section, since real inference cannot be exercised from this build environment.
  If Qwen also struggles, the next honest step (not yet taken, per the user's explicit
  choice this round) would be the deterministic keyword-fallback parser discussed but
  declined above — mirroring the pattern already built for mobile's offline slot
  extractor.

**Test results**: `pnpm test` — 91 tests passing (unchanged from previous update; this
was a model-ID swap, not a logic change), typecheck clean across all 4 packages.
