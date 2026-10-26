import { describe, expect, it } from "vitest";
import { groundIntent, resolvePayee } from "./grounding";
import { REFERENCE_CONTEXT as ctx } from "./eval/cases";
import { evaluateIntent } from "./guardrail";
import type { Intent } from "./schema/intent";

const transfer = (fromAccountId: string, toAccountId: string, amount: number): Intent => ({
  type: "transfer_internal",
  rawInputSummary: "",
  fromAccountId,
  toAccountId,
  amount,
  currency: "USD",
});

describe("groundIntent", () => {
  it("rewrites model references to real ids before the guardrail sees them", () => {
    const g = groundIntent(transfer("joint checking", "High-Yield Savings", 50), ctx);
    expect(g).toMatchObject({ status: "ok", match: "resolved", intent: { fromAccountId: "acc-checking-2", toAccountId: "acc-savings" } });
  });

  it("enforces the policy's 'same owner' condition: unknown destination is rejected even under the auto-allow threshold", () => {
    const intent = transfer("acc-checking", "evilbank", 999);
    expect(evaluateIntent(intent).decision).toBe("allow"); // the guardrail alone would let this through
    expect(groundIntent(intent, ctx)).toMatchObject({ status: "rejected" });
  });

  it("rejects numeric/invented account ids and same-account transfers", () => {
    expect(groundIntent(transfer("12345", "acc-savings", 10), ctx).status).toBe("rejected");
    expect(groundIntent(transfer("savings", "acc-savings", 10), ctx).status).toBe("rejected");
  });

  it("asks instead of guessing when a transfer has no source account", () => {
    expect(groundIntent(transfer("", "acc-savings", 10), ctx)).toMatchObject({ status: "needs_clarification", missing: ["fromAccountId"] });
  });

  it("resolves payees by id, full name or first name; unknown payees become a question", () => {
    expect(resolvePayee("jane", ctx)).toEqual({ id: "payee-jane", match: "resolved" });
    expect(resolvePayee("my landlord", ctx)).toEqual({ id: "payee-landlord", match: "resolved" });
    const g = groundIntent({ type: "pay_known_payee", rawInputSummary: "", payeeId: "Mallory", amount: 900 }, ctx);
    expect(g).toMatchObject({ status: "needs_clarification", missing: ["payeeId"] });
  });

  it("passes a model's own need_clarification through as a question", () => {
    const g = groundIntent({ type: "need_clarification", rawInputSummary: "", missing: ["amount"], question: "How much?" }, ctx);
    expect(g).toMatchObject({ status: "needs_clarification", question: "How much?" });
  });
});
