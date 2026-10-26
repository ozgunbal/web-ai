import { describe, expect, it } from "vitest";
import { Intent, riskTierForIntent } from "./intent";

describe("Intent schema", () => {
  it("parses a valid list_accounts intent", () => {
    const result = Intent.safeParse({ type: "list_accounts", rawInputSummary: "show accounts" });
    expect(result.success).toBe(true);
  });

  it("parses a valid get_transactions intent with all filters omitted", () => {
    const result = Intent.safeParse({
      type: "get_transactions",
      rawInputSummary: "recent transactions",
    });
    expect(result.success).toBe(true);
  });

  it("parses a valid get_total_balance intent with no filter", () => {
    const result = Intent.safeParse({ type: "get_total_balance", rawInputSummary: "total assets" });
    expect(result.success).toBe(true);
  });

  it("parses a valid get_total_balance intent filtered to savings", () => {
    const result = Intent.safeParse({
      type: "get_total_balance",
      rawInputSummary: "saving sum",
      accountType: "savings",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "get_total_balance") {
      expect(result.data.accountType).toBe("savings");
    }
  });

  it("rejects a get_total_balance intent with an invalid accountType", () => {
    const result = Intent.safeParse({
      type: "get_total_balance",
      rawInputSummary: "x",
      accountType: "crypto",
    });
    expect(result.success).toBe(false);
  });

  it("parses a valid transfer_internal intent and defaults currency to USD", () => {
    const result = Intent.safeParse({
      type: "transfer_internal",
      rawInputSummary: "transfer",
      fromAccountId: "a",
      toAccountId: "b",
      amount: 100,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "transfer_internal") {
      expect(result.data.currency).toBe("USD");
    }
  });

  it("rejects a transfer_internal intent missing required fields", () => {
    const result = Intent.safeParse({
      type: "transfer_internal",
      rawInputSummary: "transfer",
      amount: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a transfer_internal intent with non-positive amount", () => {
    const result = Intent.safeParse({
      type: "transfer_internal",
      rawInputSummary: "transfer",
      fromAccountId: "a",
      toAccountId: "b",
      amount: 0,
    });
    expect(result.success).toBe(false);
  });

  it("coerces a numeric-string amount (small local models commonly emit this)", () => {
    const result = Intent.safeParse({
      type: "transfer_internal",
      rawInputSummary: "transfer",
      fromAccountId: "a",
      toAccountId: "b",
      amount: "200",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "transfer_internal") {
      expect(result.data.amount).toBe(200);
    }
  });

  it("still rejects a non-numeric string amount (coercion does not mean 'anything goes')", () => {
    const result = Intent.safeParse({
      type: "transfer_internal",
      rawInputSummary: "transfer",
      fromAccountId: "a",
      toAccountId: "b",
      amount: "not a number",
    });
    expect(result.success).toBe(false);
  });

  it("still rejects a non-positive numeric-string amount", () => {
    const result = Intent.safeParse({
      type: "transfer_internal",
      rawInputSummary: "transfer",
      fromAccountId: "a",
      toAccountId: "b",
      amount: "-50",
    });
    expect(result.success).toBe(false);
  });

  it("parses a valid pay_known_payee intent", () => {
    const result = Intent.safeParse({
      type: "pay_known_payee",
      rawInputSummary: "pay Jane",
      payeeId: "p1",
      amount: 50,
    });
    expect(result.success).toBe(true);
  });

  it("rejects pay_known_payee missing payeeId", () => {
    const result = Intent.safeParse({
      type: "pay_known_payee",
      rawInputSummary: "pay Jane",
      amount: 50,
    });
    expect(result.success).toBe(false);
  });

  it("parses a valid add_payee_and_pay intent", () => {
    const result = Intent.safeParse({
      type: "add_payee_and_pay",
      rawInputSummary: "add and pay",
      payeeName: "Alex",
      payeeAccountRef: "ref-1",
      amount: 20,
    });
    expect(result.success).toBe(true);
  });

  it("rejects add_payee_and_pay missing payeeName", () => {
    const result = Intent.safeParse({
      type: "add_payee_and_pay",
      rawInputSummary: "add and pay",
      payeeAccountRef: "ref-1",
      amount: 20,
    });
    expect(result.success).toBe(false);
  });

  it("parses a valid schedule_recurring_payment intent", () => {
    const result = Intent.safeParse({
      type: "schedule_recurring_payment",
      rawInputSummary: "monthly payment",
      payeeId: "p1",
      amount: 30,
      frequency: "monthly",
      startDate: "2026-09-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects schedule_recurring_payment with invalid frequency", () => {
    const result = Intent.safeParse({
      type: "schedule_recurring_payment",
      rawInputSummary: "monthly payment",
      payeeId: "p1",
      amount: 30,
      frequency: "yearly",
      startDate: "2026-09-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-schema (unknown) intent type", () => {
    const result = Intent.safeParse({
      type: "delete_account",
      rawInputSummary: "delete everything",
    });
    expect(result.success).toBe(false);
  });

  it("defaults rawInputSummary to an empty string when omitted (small local models frequently drop it)", () => {
    // Deliberately relaxed: rawInputSummary is a "nice to have" audit-log
    // paraphrase, not part of the actual security boundary (closed intent
    // type enum + required action fields). Omitting it must not fail an
    // otherwise well-formed intent.
    const result = Intent.safeParse({ type: "list_accounts" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rawInputSummary).toBe("");
  });

  it("narrows the discriminated union so fields are accessible without a cast", () => {
    const result = Intent.safeParse({
      type: "transfer_internal",
      rawInputSummary: "transfer",
      fromAccountId: "a",
      toAccountId: "b",
      amount: 100,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "transfer_internal") {
      expect(result.data.fromAccountId).toBe("a");
      expect(result.data.toAccountId).toBe("b");
      expect(result.data.amount).toBe(100);
    }
  });
});

describe("riskTierForIntent", () => {
  it("maps read-only intents", () => {
    expect(riskTierForIntent("list_accounts")).toBe("read_only");
    expect(riskTierForIntent("get_transactions")).toBe("read_only");
    expect(riskTierForIntent("get_total_balance")).toBe("read_only");
  });

  it("maps bounded intents", () => {
    expect(riskTierForIntent("transfer_internal")).toBe("bounded");
    expect(riskTierForIntent("pay_known_payee")).toBe("bounded");
  });

  it("maps high_risk intents", () => {
    expect(riskTierForIntent("add_payee_and_pay")).toBe("high_risk");
    expect(riskTierForIntent("schedule_recurring_payment")).toBe("high_risk");
  });
});
