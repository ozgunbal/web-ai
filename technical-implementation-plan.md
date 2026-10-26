# Technical implementation plan — agent-augmented app demo

**Purpose of this doc:** hand-off spec for Claude Code to build a working demo. Covers stack, repo layout, data contracts, and phased tasks with acceptance criteria. This is a conference-demo build, not production software — prioritize reliability of the specific demo path over generality.

**Non-negotiable constraint:** this project only ever talks to a **mock app you control**, seeded with fake data. No real banking APIs, no real third-party sites, no real money movement, ever. This removes legal/ToS risk and removes the biggest source of live-demo brittleness (someone else's app changing under you).

---

## 1. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo tooling | pnpm workspaces | Simple, no build-system overhead needed for a demo |
| Language | TypeScript everywhere | One schema (zod) shared across web, mobile, core |
| Core agent logic | Plain TS, no framework | Intent parser + guardrail must be inspectable and demo-safe — no hidden framework magic |
| LLM (intent parsing, web) | **WebLLM** (`@mlc-ai/web-llm`), running client-side via WebGPU | No cloud round-trip, nothing leaves the browser — stronger security/privacy story, and it makes the web demo genuinely offline-capable too, not just the mobile one |
| LLM (intent parsing, mobile) | Simplified keyword/slot extractor (unchanged from original plan) | WebLLM requires WebGPU, which isn't available inside a React Native runtime — see Section 4.1b for the real options if you want true on-device inference on mobile later |
| Model choice | A small instruction-tuned model from WebLLM's prebuilt list — e.g. a quantized Gemma 2B/2 model, or Qwen2.5-1.5B-Instruct as a fallback if Gemma's structured-output reliability is weaker | Gemma is a genuine, non-forced Google tie-in for DevFest; pick based on actual structured-output test results (Section 5, Phase 2), not brand alone |
| Guardrail engine | Deterministic TS rule evaluation, **no LLM call** | Must be auditable and demo-reliable; this is the point of the whole architecture |
| Web mock app | React + Vite | Fast dev loop, matches your existing stack |
| Web state/data | In-memory + localStorage seed data, no real backend required | Demo only needs to look real, not persist across sessions |
| Web adapter (perception) | `data-agent-*` attributes on interactive elements, not raw DOM scraping | Far more reliable live than accessibility-tree parsing of arbitrary markup — see Section 4 rationale |
| Mobile mock app | Expo (React Native) | Matches your RN background, fast iteration |
| Mobile offline detection | `@react-native-community/netinfo` | Standard, reliable |
| Mobile local storage/queue | `expo-sqlite` or simple AsyncStorage-backed queue | Simple queue is enough — don't over-engineer |
| On-device intent parsing (mobile) | **Mocked/simplified keyword+slot extractor**, not a real local LLM, unless time allows | See Section 7 — this is explicitly scoped down to protect the timeline |

---

## 2. Monorepo structure

```
agent-demo/
├── packages/
│   ├── core/                    # Shared, framework-agnostic agent logic
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── intent.ts        # Zod schemas for all intent types
│   │   │   │   └── policy.ts        # Zod schema for policy rules
│   │   │   ├── intent-parser.ts     # Text -> structured Intent (calls Claude API)
│   │   │   ├── guardrail.ts         # Intent -> Decision (allow/confirm/block)
│   │   │   ├── policy.config.ts     # The actual policy rules (data, not code)
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── web-demo/                # Mock banking app + agent overlay
│   │   ├── src/
│   │   │   ├── app/                 # The "existing app" — accounts, transfers, payees
│   │   │   ├── agent-overlay/       # Chat panel, calls into @agent-demo/core
│   │   │   ├── mock-data/           # Seeded accounts, transactions, payees
│   │   │   └── injection-scenario/  # The planted prompt-injection content
│   │   └── package.json
│   │
│   ├── mobile-demo/             # Expo app, offline agent
│   │   ├── src/
│   │   │   ├── app/                 # Minimal mock UI
│   │   │   ├── agent/               # On-device parser (simplified), offline queue
│   │   │   └── mock-data/
│   │   └── package.json
│   │
│   └── shared/                  # Types shared beyond core (UI-facing DTOs)
│       └── src/index.ts
│
├── docs/
│   └── demo-script.md           # Step-by-step what happens on stage (write in Phase 5)
├── pnpm-workspace.yaml
└── README.md
```

---

## 3. Core data contracts

These are the load-bearing types. Build these first — everything else depends on them.

### 3.1 Intent schema (`packages/core/src/schema/intent.ts`)

```typescript
import { z } from "zod";

// Fixed, closed set of actions. The agent can NEVER propose an action
// outside this enum — that closed set IS the security boundary.
export const IntentType = z.enum([
  "list_accounts",
  "get_transactions",
  "transfer_internal",      // between the user's own accounts
  "pay_known_payee",        // existing, previously-used payee
  "add_payee_and_pay",      // first-time payee — always high risk
  "schedule_recurring_payment",
]);

export const RiskTier = z.enum(["read_only", "bounded", "high_risk"]);

const baseIntent = z.object({
  type: IntentType,
  rawInputSummary: z.string(), // short paraphrase of what the user asked, for audit log
});

export const ListAccountsIntent = baseIntent.extend({
  type: z.literal("list_accounts"),
});

export const TransferInternalIntent = baseIntent.extend({
  type: z.literal("transfer_internal"),
  fromAccountId: z.string(),
  toAccountId: z.string(),
  amount: z.number().positive(),
  currency: z.string().default("USD"),
});

export const PayKnownPayeeIntent = baseIntent.extend({
  type: z.literal("pay_known_payee"),
  payeeId: z.string(),
  amount: z.number().positive(),
});

export const AddPayeeAndPayIntent = baseIntent.extend({
  type: z.literal("add_payee_and_pay"),
  payeeName: z.string(),
  payeeAccountRef: z.string(),
  amount: z.number().positive(),
});

// Discriminated union — this is the ONLY shape the guardrail ever sees.
// Raw user text never reaches the guardrail or the adapters.
export const Intent = z.discriminatedUnion("type", [
  ListAccountsIntent,
  TransferInternalIntent,
  PayKnownPayeeIntent,
  AddPayeeAndPayIntent,
  // add GetTransactions, ScheduleRecurring similarly
]);

export type Intent = z.infer<typeof Intent>;
```

### 3.2 Policy / guardrail schema (`packages/core/src/schema/policy.ts`)

```typescript
import { z } from "zod";

export const Decision = z.enum(["allow", "confirm", "block"]);

export const PolicyRule = z.object({
  id: z.string(),
  appliesTo: z.array(z.string()), // intent types
  condition: z.string(),           // human-readable, for the audit log/slide
  decision: Decision,
  reason: z.string(),
});

export type PolicyRule = z.infer<typeof PolicyRule>;
export type Decision = z.infer<typeof Decision>;
```

### 3.3 Policy config — this is DATA, not code (`packages/core/src/policy.config.ts`)

Keep policy as declarative data so it's easy to show on a slide and easy to reason about live on stage.

```typescript
import { PolicyRule } from "./schema/policy";

export const POLICY_RULES: PolicyRule[] = [
  {
    id: "read-only-always-allowed",
    appliesTo: ["list_accounts", "get_transactions"],
    condition: "read-only action",
    decision: "allow",
    reason: "No state change — safe to auto-execute.",
  },
  {
    id: "internal-transfer-small-amount",
    appliesTo: ["transfer_internal"],
    condition: "amount <= 1000 AND same owner",
    decision: "allow",
    reason: "Money stays with the same account holder, below threshold.",
  },
  {
    id: "internal-transfer-large-amount",
    appliesTo: ["transfer_internal"],
    condition: "amount > 1000",
    decision: "confirm",
    reason: "Above auto-approval threshold — requires explicit confirmation.",
  },
  {
    id: "known-payee-payment",
    appliesTo: ["pay_known_payee"],
    condition: "payee already exists on account",
    decision: "confirm",
    reason: "Moving money externally always requires confirmation, even to a known payee.",
  },
  {
    id: "new-payee-always-blocked-from-auto",
    appliesTo: ["add_payee_and_pay"],
    condition: "first-time payee",
    decision: "block",
    reason: "New payee + immediate payment is never auto-approved — requires out-of-band confirmation, not just an in-chat yes.",
  },
];
```

---

## 4. Component specs

### 4.1 Intent parser (`packages/core/src/intent-parser.ts`) — web, via WebLLM

- **Input:** raw user text (or transcribed voice).
- **Output:** a validated `Intent` object, or a rejection if the model's output doesn't parse against the zod schema.
- **Implementation:** load a small model via `CreateMLCEngine` from `@mlc-ai/web-llm`, call `engine.chat.completions.create()` with `response_format: { type: "json_object" }` (or the grammar/schema-constrained variant if the model+WebLLM version supports it), instructing the model to emit JSON matching the `Intent` union. **Reject anything that doesn't validate against the zod schema — do not attempt to "fix" malformed output.** This strict rejection is itself part of the injection defense: injected instructions that try to smuggle in an out-of-schema action simply fail to parse.
- **Explicitly log:** raw input text, parsed intent (or rejection reason) — this is your audit trail and your "look what the system caught" demo evidence.
- **Reliability note:** small quantized models are meaningfully less reliable at strict JSON/schema adherence than a large cloud model. Budget real testing time for this in Phase 2 (see below) — plan on a retry-with-stricter-prompt loop (e.g. up to 2 retries) before treating a parse as failed, and pick your model based on measured schema-adherence rate on your actual test utterances, not on general model reputation.
- **Model loading:** WebLLM downloads model weights into browser cache (IndexedDB) on first load — this can be several hundred MB to a few GB depending on the model. **Pre-warm the cache on the presentation machine before going on stage.** Build a visible loading/progress state for the demo itself (it's honest and mildly interesting to show once, but you do not want it happening live and unplanned).
- **Hardware/browser requirement:** WebGPU support. Test on the actual machine and browser you'll present with — Chrome and Edge have the most consistent WebGPU support; Safari's support is version-dependent. Do this test in Phase 2, not the week of the talk.

#### 4.1b If you later want true on-device inference on mobile too

Not in scope for the current plan (see Section 7), but noted for completeness: WebLLM itself won't run inside a bare React Native runtime because it depends on WebGPU. Real on-device options for mobile would be `llama.rn` (llama.cpp bindings for React Native) or MLC-LLM's native iOS/Android runtime. Either is a meaningfully larger scope addition — treat as a stretch goal only if Phases 1-3 finish with time to spare, and never let it threaten the MVP.

### 4.2 Guardrail engine (`packages/core/src/guardrail.ts`)

- **Input:** a validated `Intent`.
- **Output:** `{ decision: Decision, matchedRule: PolicyRule }`.
- **Implementation:** pure function, iterates `POLICY_RULES`, first match wins (or most specific match — keep the resolution order simple and documented). No LLM call here — deterministic and testable.
- **Testing:** this is the easiest part of the system to unit test exhaustively. Write tests for every rule before building any UI around it.

### 4.3 Web adapter — perception + action

**Rationale for `data-agent-*` attributes instead of raw DOM/accessibility-tree scraping:** raw DOM scraping is the most realistic architecture for "augmenting an app you truly don't control," but it is also the most likely thing to break unpredictably during a live demo. Since this is your own mock app, use explicit `data-agent-action="transfer_internal"` and `data-agent-field="amount"` attributes on the real interactive elements. This is honest — say on stage: *"in this demo I own the app, so I've marked up the actions explicitly; against a truly third-party app you'd fall back to accessibility-tree inference, which is strictly harder and a good follow-up topic."* This framing is more credible than pretending full generality you haven't built.

- Web adapter reads these attributes to know what actions exist on the current screen.
- Execution = the adapter finds the matching element(s) and performs the same interaction a user would (fill fields, click submit) — do this via actual DOM events, not a hidden backend call, so the demo visibly shows the UI being operated.

### 4.4 Mobile adapter — offline queue

- Queue is a simple array persisted locally: `{ intent: Intent, decision: Decision, queuedAt: timestamp }`.
- **Explicit rule, enforced in code, not just in the talk:** any intent with `riskTier !== "read_only"` that involves money movement (`transfer_internal`, `pay_known_payee`, `add_payee_and_pay`) is **rejected from the offline queue outright** — show an explicit "requires connection" message rather than queuing it. This is a real code path, not just a slide claim.
- On reconnect: drain the queue through the normal guardrail path (not a bypass) — reconnecting doesn't skip policy checks.

### 4.5 Mock app (web)

Minimal screens needed:
- Accounts list (2-3 fake accounts with balances)
- Transaction history (filterable, enough fake data to make search/filter demos convincing)
- Transfer form (internal)
- Pay-a-payee form (with at least one existing payee, and a path to "add new payee")
- One screen or transaction description field containing the planted injection text (see 4.6)

### 4.6 Injection scenario — build this as a fixed, reproducible fixture

Do not rely on "the model happens to get tricked live." Hard-code a specific transaction description or page element containing something like (paraphrased, not literal — keep it clearly a demo artifact):
> a note field on a transaction that contains an embedded instruction attempting to redirect a payment

Then demo: user asks the agent an unrelated, innocuous question (e.g. "summarize my recent transactions"). The agent's perception layer reads that transaction data — including the injected text — but because the intent parser only ever produces the discriminated `Intent` type, and the injected text isn't part of the user's actual request, the malicious "instruction" has no path to becoming an executed action. Log this explicitly so you can show the log on a slide: "content observed, no matching user intent, nothing executed."

---

## 5. Phased build tasks (hand these to Claude Code sequentially)

### Phase 1 — Schemas and guardrail (no UI yet)
- [ ] Set up pnpm workspace, `packages/core` with the schemas in Section 3
- [ ] Implement `guardrail.ts` against `policy.config.ts`
- [ ] Write unit tests covering every policy rule (allow/confirm/block cases) plus edge cases (amount exactly at threshold, unknown intent type)
- **Acceptance criteria:** `pnpm test` passes; guardrail behavior is fully deterministic and demonstrable via a simple CLI script (`pnpm demo:guardrail` printing decisions for a handful of sample intents)

### Phase 2 — Intent parser (WebLLM)
- [ ] Integrate `@mlc-ai/web-llm`, load a candidate small model, confirm it runs on your actual dev + presentation hardware
- [ ] Implement `intent-parser.ts` with JSON/schema-constrained output, strict zod validation, and a bounded retry loop (max 2 retries) on parse failure
- [ ] Write a test harness with ~15-20 example utterances (mix of clearly-valid, ambiguous, and adversarial inputs); measure schema-adherence rate
- [ ] **Model bake-off:** run the same test harness against at least one alternative model (e.g. Gemma vs. Qwen2.5-1.5B-Instruct) and pick based on measured reliability, not assumption
- [ ] Confirm first-load model download works and build the loading-state UI; pre-warm the cache and document the pre-warm step in the demo script
- **Acceptance criteria:** chosen model hits an acceptable schema-adherence rate on your test set (define "acceptable" once you see real numbers — don't guess this threshold in advance); adversarial/off-schema attempts are rejected, not coerced; cold-start load time is known and accounted for in the demo script

### Phase 3 — Web mock app + adapter
- [ ] Build the mock app screens (Section 4.5) with seeded fake data
- [ ] Add `data-agent-*` markup to interactive elements
- [ ] Build the web adapter: reads available actions from current screen, executes approved intents via real DOM interaction
- [ ] Build the injection scenario fixture (Section 4.6)
- [ ] Build the agent-overlay chat panel (text input, shows parsed intent + guardrail decision + confirm/cancel UI)
- **Acceptance criteria:** end-to-end flow works live: type a request → see parsed intent → see guardrail decision → confirm if required → see the actual UI update. Injection scenario reliably produces "observed but not executed" outcome every time you test it (run it 10+ times in a row to confirm reliability before trusting it on stage)

### Phase 4 — Mobile adapter (scoped down per Section 1)
- [ ] Minimal Expo app with 1-2 screens
- [ ] Simplified on-device intent extraction (keyword/slot-based is acceptable — do not attempt a real local LLM unless Phase 1-3 finished with time to spare)
- [ ] Offline detection + queue with the money-movement rejection rule (Section 4.4) as actual enforced code
- [ ] Reconnect flow draining the queue through the guardrail
- **Acceptance criteria:** toggling airplane mode visibly changes behavior (read-only actions queue, money-movement actions are refused with a clear message); reconnect drains the queue correctly

### Phase 5 — Demo script + recordings
- [ ] Write `docs/demo-script.md`: exact sequence of inputs to use live, expected outputs, and what to say at each beat
- [ ] Record every demo segment (web flow, injection scenario, mobile offline/reconnect) as a fallback video
- [ ] Test the recorded fallback actually plays correctly on the presentation machine/setup

---

## 6. Environment setup

No API key required for the web intent parser — this is worth saying explicitly on stage (nothing leaves the browser).

```bash
# Install
pnpm install

# Run web demo (first run will download the WebLLM model into browser cache —
# expect this to take a while; subsequent runs load from cache)
pnpm --filter web-demo dev

# Run mobile demo
pnpm --filter mobile-demo start

# Run guardrail tests
pnpm --filter core test

# Run the intent-parser model bake-off harness (Phase 2)
pnpm --filter core test:intent-parser
```

**Before presenting, on the actual presentation machine:**
1. Open the web demo once, fully, to force the model download and populate the browser cache
2. Confirm WebGPU is active (most browsers expose this in dev tools / `chrome://gpu`)
3. Re-test after any browser update, OS update, or machine change between now and the talk — cache and WebGPU support can be sensitive to both

---

## 7. Explicit scope-down notes (read before building)

- **On-device model on mobile:** true on-device LLM inference (`llama.rn` or MLC native) is out of scope for the initial build — WebLLM itself doesn't run in React Native. Use simplified keyword+slot extraction on mobile. If time allows after Phase 3, revisit as a stretch goal (Section 4.1b) — do not let this block the schedule.
- **DOM perception generality:** using `data-agent-*` markers instead of true accessibility-tree inference is a deliberate, disclosed simplification for demo reliability — not a limitation to hide. State it plainly in the talk (see Section 4.3).
- **Injection defense claim:** the system defends against one specific, demonstrated injection pattern via schema constraint. It does not claim general robustness against all prompt injection. Do not let slide copy or live framing imply otherwise.
- **Small-model structured-output reliability:** be honest in the talk that the web demo's on-device model is less reliable at strict schema adherence than a large cloud model would be — that's the real tradeoff of going fully on-device, and naming it openly is more credible than glossing over it. The retry loop and measured bake-off numbers (Phase 2) are your evidence, not a guess.
- **WebGPU as a new dependency:** this replaces "API key + network reliability" risk with "WebGPU support + model cache" risk. It's not strictly less risky, just a different risk — treat the presentation-machine pre-warm step (Section 6) as mandatory, not optional.

---

## 8. Definition of done (engineering)

- [ ] All Phase 1-3 acceptance criteria met (Phase 4 mobile can ship as recording-only if behind schedule, per the project implementation plan's fallback rules)
- [ ] Guardrail fully unit-tested and deterministic
- [ ] Injection scenario reproduced successfully 10+ times in a row
- [ ] Every live demo segment has a tested, working recorded fallback
- [ ] `docs/demo-script.md` complete and rehearsed against
