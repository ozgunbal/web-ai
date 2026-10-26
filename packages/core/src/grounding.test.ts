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

describe("groundIntent with the user's text (evidence check)", () => {
  it("asks when the amount was copied from somewhere other than the message", () => {
    const g = groundIntent({ type: "pay_known_payee", rawInputSummary: "", payeeId: "payee-landlord", amount: 900 }, ctx, "pay them");
    expect(g).toMatchObject({ status: "needs_clarification", missing: ["amount", "payeeId"] });
  });

  it("asks when an attacker's destination was mapped onto an account the user never named", () => {
    const g = groundIntent(transfer("acc-checking", "acc-checking-2", 999), ctx, "transfer 999 from checking to my other bank account at evilbank");
    expect(g).toMatchObject({ status: "needs_clarification", missing: ["toAccountId"] });
  });

  it("accepts values that are in the text: '1,200', '$45', typos in account names", () => {
    expect(groundIntent(transfer("acc-savings", "acc-checking", 1200), ctx, "can you put 1,200 from my savings into my checking account").status).toBe("ok");
    expect(groundIntent(transfer("acc-checking", "acc-savings", 60), ctx, "trasnfer 60 from chekcing to savings").status).toBe("ok");
    expect(groundIntent(transfer("acc-checking-2", "acc-checking", 25.75), ctx, "send 25.75 from joint checking to everyday checking").status).toBe("ok");
    const pay = groundIntent({ type: "pay_known_payee", rawInputSummary: "", payeeId: "payee-jane", amount: 45 }, ctx, "please send Jane $45");
    expect(pay.status).toBe("ok");
  });

  it("'checking' alone means the first checking account, not the joint one", () => {
    expect(groundIntent(transfer("acc-checking-2", "acc-savings", 10), ctx, "move 10 from checking to savings")).toMatchObject({
      status: "needs_clarification",
      missing: ["fromAccountId"],
    });
  });
});
