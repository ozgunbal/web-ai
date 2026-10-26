# Phase 9 — ≥90% on a held-out set without changing the model

Status: **target met. The app's model (Qwen2.5-1.5B) scores 43/44 (98%) on a held-out
test split with the v4 pipeline, 100% safe on ambiguous requests and attacks, median
1.9s. Live-verified in the real app.**

User's goal for this phase: at least 90% success without changing the model, and drop
gemma3-1b from runs (~35s per case, unusable in every variant).

## Protocol (why the 90% can be quoted)

1. **Success** = the full app pipeline (model + code) gets the case right: a valid
   request is executed with the right action and values; an ambiguous request is
   answered with a question or refused; an attack is never auto-executed.
2. **Held-out split.** 44 new cases (`core/src/eval/cases-test.ts`: 24 valid, 10
   ambiguous, 10 adversarial, including typos, slang, "1,200", "every two weeks",
   unsaved recipients) were committed in `be6263b` **before** any tuning.
3. Improvements were developed **only against the 28 dev cases**. v4 was frozen in a
   commit (`4cdbaef`) and then run once on the test split.
4. Honest caveat: the v3 *baseline* was measured on the test split before v4 was built,
   so its failures were visible. v4's design came from dev failures (the action-choice
   errors on "send jane 120 bucks" and "pay Jane 25 every week"), which the test
   failures happened to resemble.

## What changed

### Evidence check (code, `grounding.ts`)

`groundIntent(intent, ctx, userText)`: a money amount, account or payee that does not
appear in the user's own message becomes a clarifying question. Accounts count as
mentioned via a distinctive name word ("joint", "everyday") or their type word if they
are the first of that type; words of 5+ letters tolerate typos ("chekcing"); numbers
are read as written ("1,200", "$45"). Read-only filters the user never mentioned are
dropped instead of applied.

Motivation (dev, Phase 8): on ambiguous requests, models filled gaps by **copying
values from the prompt's own examples** (payee-landlord/900, Bob Lee/12-3456, 40,
payee-jane/15), and the v3 id enum mapped attacker destinations onto the user's own
accounts. Both produce values that are valid against the data but absent from the
message.

### v4 two-stage parser (`two-stage.ts`)

1. **Classify**: a short prompt describing each action; output constrained to
   `{"action": <8-value enum incl. not_banking>}`.
2. **Extract**: only that action's fields, all optional, ids as enums; "leave out
   anything the user did not say".
3. **Code decides what is missing** (required field absent → `need_clarification`).
   `not_banking` and `list_accounts` need no second call.

## Results — held-out test split, full pipeline

| Model | v3 + code | **v4 + code** | v4 median |
|---|---|---|---|
| **Qwen2.5-1.5B (app)** | 95% | **98%** | 1.9s |
| Phi-3.5-mini | 100% | 95% | 5.3s |
| gemma-2-2b | 100% | 93% | 3.0s |
| Llama-3.2-1B | 82% | 84% | 1.3s |
| Qwen2.5-0.5B | 80% | 82% | 0.7s |

Baseline before this phase (Qwen2.5-1.5B, v3, no evidence check): **73%** (ambiguous
40%, attacks 60%).

Findings:

1. **Safety became model-independent**: with the evidence check, every model is 100%
   safe on ambiguous and adversarial test cases and no money leaves the user. Models now
   only differ in how many valid requests they get right.
2. **v4 is the best fit for the app's model** (98%, and faster than v3 because the
   classifier prompt is short). For the two largest models, the single-call v3 is
   slightly better than v4 (100% vs 93–95%): splitting the task helps small models more
   than large ones.
3. **Example copying persists in v4**: the one Qwen2.5-1.5B test failure, "find my rent
   payments" → `pay_known_payee landlord 900`, took 900 from the extractor's example. In
   the app it is a safe failure: the evidence check asks instead of paying.
4. **Live use found a gap the test sets didn't**: "how much do I have in total" came back
   filtered to checking (`accountType` invented). Fixed by dropping unmentioned
   read-only filters; the scorer was made stricter so an invented filter on a plain
   total no longer counts as correct. Re-scoring changed no held-out result.

## Report fixes made in this phase

- The report kept the latest run per model+variant, so the test-split runs silently
  hid the dev-split runs of the same model+variant (644 instead of 812 records). The
  key now includes the split.
- The headline table pooled v0–v3 over 6 models (incl. gemma3) but v4 over 5; it now
  pools only models that ran every variant.

## Caveats

- 24 valid test cases: one case is ~4 percentage points; 98% vs 95% is one case.
- One machine (M3 Pro, Chrome via CDP), temperature 0, one run per cell.
- The evidence check is English-only and digit-only (no "fifty", no Turkish).
