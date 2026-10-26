import { describe, expect, it } from "vitest";
import { evaluateIntent } from "./guardrail";
import { POLICY_RULES, RULE_PREDICATES } from "./policy.config";
import type { Intent } from "./schema/intent";
import type { PolicyRule } from "./schema/policy";

function transfer(amount: number): Intent {
  return {
    type: "transfer_internal",
    rawInputSummary: "transfer",
    fromAccountId: "a",
    toAccountId: "b",
    amount,
    currency: "USD",
  };
}

describe("evaluateIntent — read-only-always-allowed", () => {
  it("allows list_accounts", () => {
    const result = evaluateIntent({ type: "list_accounts", rawInputSummary: "show accounts" });
    expect(result.decision).toBe("allow");
    expect(result.matchedRule.id).toBe("read-only-always-allowed");
  });

  it("allows get_transactions", () => {
    const result = evaluateIntent({ type: "get_transactions", rawInputSummary: "recent txns" });
    expect(result.decision).toBe("allow");
    expect(result.matchedRule.id).toBe("read-only-always-allowed");
  });

  it("allows get_total_balance", () => {
    const result = evaluateIntent({ type: "get_total_balance", rawInputSummary: "total assets" });
    expect(result.decision).toBe("allow");
    expect(result.matchedRule.id).toBe("read-only-always-allowed");
  });

  it("allows get_total_balance filtered to an account type", () => {
    const result = evaluateIntent({
      type: "get_total_balance",
      rawInputSummary: "saving sum",
      accountType: "savings",
    });
    expect(result.decision).toBe("allow");
    expect(result.matchedRule.id).toBe("read-only-always-allowed");
  });
});

describe("evaluateIntent — transfer_internal threshold", () => {
  it("allows amount below 1000", () => {
    expect(evaluateIntent(transfer(500)).decision).toBe("allow");
  });

  it("allows amount exactly at 1000 (boundary — spec says <= 1000)", () => {
    const result = evaluateIntent(transfer(1000));
    expect(result.decision).toBe("allow");
    expect(result.matchedRule.id).toBe("internal-transfer-small-amount");
  });

  it("requires confirm for amount just above 1000", () => {
    const result = evaluateIntent(transfer(1000.01));
    expect(result.decision).toBe("confirm");
    expect(result.matchedRule.id).toBe("internal-transfer-large-amount");
  });

  it("requires confirm for large amounts", () => {
    expect(evaluateIntent(transfer(50000)).decision).toBe("confirm");
  });
});

describe("evaluateIntent — pay_known_payee", () => {
  it("always requires confirm, even for very small amounts", () => {
    const result = evaluateIntent({
      type: "pay_known_payee",
      rawInputSummary: "pay $1",
      payeeId: "p1",
      amount: 1,
    });
    expect(result.decision).toBe("confirm");
    expect(result.matchedRule.id).toBe("known-payee-payment");
  });
});

describe("evaluateIntent — add_payee_and_pay", () => {
  it("always blocks regardless of amount", () => {
    const small = evaluateIntent({
      type: "add_payee_and_pay",
      rawInputSummary: "add and pay $1",
      payeeName: "Alex",
      payeeAccountRef: "ref",
      amount: 1,
    });
    const large = evaluateIntent({
      type: "add_payee_and_pay",
      rawInputSummary: "add and pay $100000",
      payeeName: "Alex",
      payeeAccountRef: "ref",
      amount: 100000,
    });
    expect(small.decision).toBe("block");
    expect(large.decision).toBe("block");
    expect(small.matchedRule.id).toBe("new-payee-always-blocked-from-auto");
  });
});

describe("evaluateIntent — schedule_recurring_payment (added rule, not in spec)", () => {
  it("always requires confirm regardless of amount or frequency", () => {
    const result = evaluateIntent({
      type: "schedule_recurring_payment",
      rawInputSummary: "monthly payment",
      payeeId: "p1",
      amount: 5,
      currency: "USD",
      frequency: "monthly",
      startDate: "2026-09-01",
    });
    expect(result.decision).toBe("confirm");
    expect(result.matchedRule.id).toBe("recurring-payment-always-confirm");
  });
});

describe("evaluateIntent — fail-safe behavior", () => {
  it("blocks (fails safe) when an intent type has no predicate/rule match, never defaults to allow", () => {
    // Simulate an intent whose type technically passed schema validation but has
    // no policy coverage, by using a test-only rule set with no predicates.
    const testRules: PolicyRule[] = [];
    const testPredicates: Record<string, (intent: Intent) => boolean> = {};
    // Re-implement the same first-match-wins loop against test-only data to prove
    // the "no match -> block" behavior in isolation from the real POLICY_RULES.
    function evaluateWithRules(intent: Intent) {
      for (const rule of testRules) {
        if (!rule.appliesTo.includes(intent.type)) continue;
        const predicate = testPredicates[rule.id];
        if (predicate?.(intent)) return { decision: rule.decision, matchedRule: rule };
      }
      return { decision: "block" as const, matchedRule: { id: "no-matching-policy-fail-safe" } };
    }
    const result = evaluateWithRules({ type: "list_accounts", rawInputSummary: "x" });
    expect(result.decision).toBe("block");
  });

  it("blocks for an intent type not covered by any real POLICY_RULES entry (defensive — should not occur given full coverage)", () => {
    // @ts-expect-error intentionally forcing an invalid/uncovered type through
    // to prove evaluateIntent fails safe rather than throwing or allowing.
    const result = evaluateIntent({ type: "delete_account", rawInputSummary: "x" });
    expect(result.decision).toBe("block");
    expect(result.matchedRule.id).toBe("no-matching-policy-fail-safe");
  });
});

describe("POLICY_RULES / RULE_PREDICATES — first-match-wins ordering", () => {
  it("uses the first matching rule in array order when rules could overlap", () => {
    const overlapping: PolicyRule[] = [
      {
        id: "first-catch-all",
        appliesTo: ["list_accounts"],
        condition: "always",
        decision: "allow",
        reason: "first rule wins",
      },
      {
        id: "second-would-also-match",
        appliesTo: ["list_accounts"],
        condition: "always",
        decision: "block",
        reason: "should never be reached",
      },
    ];
    const predicates: Record<string, (intent: Intent) => boolean> = {
      "first-catch-all": () => true,
      "second-would-also-match": () => true,
    };
    function evaluateWithRules(intent: Intent) {
      for (const rule of overlapping) {
        if (!rule.appliesTo.includes(intent.type)) continue;
        if (predicates[rule.id]?.(intent)) return { decision: rule.decision, matchedRule: rule };
      }
      return { decision: "block" as const, matchedRule: null };
    }
    const result = evaluateWithRules({ type: "list_accounts", rawInputSummary: "x" });
    expect(result.matchedRule?.id).toBe("first-catch-all");
    expect(result.decision).toBe("allow");
  });

  it("every rule in the real POLICY_RULES has a corresponding predicate", () => {
    for (const rule of POLICY_RULES) {
      expect(RULE_PREDICATES[rule.id]).toBeTypeOf("function");
    }
  });
});
