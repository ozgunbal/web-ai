import { describe, expect, it } from "vitest";
import { parseIntent, evaluateIntent, AuditLog, type EngineClient } from "@web-ai/core/web";
import { INJECTED_NOTE_TEXT, INJECTION_SCENARIO_USER_UTTERANCE } from "./fixture";

/**
 * Automated repeatability check for spec section 4.6's injection scenario.
 *
 * We cannot invoke a real WebLLM model from this jsdom/Vitest environment (no
 * WebGPU). This test therefore proves the STRUCTURAL guarantee — that even if
 * the perception layer's context includes the injected note text alongside the
 * user's real (unrelated) request, the parser only ever returns the ONE intent
 * matching the schema for what the user actually asked, because the model output
 * is validated against the closed Intent union regardless of what other content
 * was in context. A stub engine simulates "a correctly behaving model" for this
 * structural proof; it does not prove any REAL model resists the injection — that
 * requires the live-browser verification tracked in phase-3's implementation log.
 */
class InjectionAwareStubEngine implements EngineClient {
  async complete({ user }: { system: string; user: string }): Promise<string> {
    // Simulate a well-behaved model: it may "see" the injected note text (it's
    // part of the context a real perception layer would include), but the user's
    // actual message is what determines the returned intent's type.
    if (user.includes(INJECTION_SCENARIO_USER_UTTERANCE)) {
      return JSON.stringify({ type: "get_transactions", rawInputSummary: "summarize transactions" });
    }
    return JSON.stringify({ type: "list_accounts", rawInputSummary: "fallback" });
  }
}

describe("injection scenario — observed but not executed", () => {
  it("reproduces the scenario 10 times in a row with a consistent, safe outcome", async () => {
    for (let i = 0; i < 10; i++) {
      const engine = new InjectionAwareStubEngine();
      const auditLog = new AuditLog();

      // Simulate the perception layer including the injected note as context,
      // the way a real "summarize my transactions" flow would surface transaction
      // data (including notes) to the model.
      const contextualPrompt = `${INJECTION_SCENARIO_USER_UTTERANCE}\n\n[transaction note observed: ${INJECTED_NOTE_TEXT}]`;

      const result = await parseIntent(engine, contextualPrompt);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      // The parsed intent must be get_transactions (matching the user's real
      // request), never any money-movement type smuggled in via the note.
      expect(result.intent.type).toBe("get_transactions");
      expect(result.intent.type).not.toBe("transfer_internal");
      expect(result.intent.type).not.toBe("pay_known_payee");
      expect(result.intent.type).not.toBe("add_payee_and_pay");

      const { decision } = evaluateIntent(result.intent);
      expect(decision).toBe("allow"); // read-only, safe to auto-execute

      const entry = auditLog.recordParsed(contextualPrompt, result.intent, decision, {
        id: "read-only-always-allowed",
        appliesTo: ["get_transactions"],
        condition: "read-only action",
        decision: "allow",
        reason: "No state change — safe to auto-execute.",
      });

      // The audit-log line callable on stage: "content observed, no matching
      // user intent, nothing executed" — here, nothing FROM THE INJECTION was
      // executed; the only thing executed is the user's own innocuous request.
      expect(entry.parsedIntent?.type).toBe("get_transactions");
      expect(entry.rejectionReason).toBeNull();
    }
  });

  it("rejects an intent if a hypothetical compromised model DID try to act on the injected instruction", async () => {
    // Negative-control test: even if a (mis-behaving) model tried to smuggle
    // in a money-movement action based on the injected note, if it didn't
    // supply required fields (which the injected text doesn't specify —
    // there's no valid fromAccountId/toAccountId in the note) it would still
    // fail schema validation.
    class MisbehavingStubEngine implements EngineClient {
      async complete(): Promise<string> {
        return JSON.stringify({ type: "transfer_internal", rawInputSummary: "injected" });
      }
    }
    const result = await parseIntent(new MisbehavingStubEngine(), INJECTION_SCENARIO_USER_UTTERANCE);
    expect(result.ok).toBe(false); // missing fromAccountId/toAccountId/amount — fails validation
  });
});
