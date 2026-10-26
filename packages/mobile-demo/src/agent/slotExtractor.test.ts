import { extractIntent } from "./slotExtractor";

describe("extractIntent — list_accounts", () => {
  it("matches 'show me my accounts'", () => {
    const result = extractIntent("show me my accounts");
    expect(result.ok).toBe(true);
    expect(result.intent?.type).toBe("list_accounts");
  });
});

describe("extractIntent — get_transactions", () => {
  it("matches a request mentioning transactions", () => {
    const result = extractIntent("what are my recent transactions");
    expect(result.ok).toBe(true);
    expect(result.intent?.type).toBe("get_transactions");
  });
});

describe("extractIntent — transfer_internal", () => {
  it("extracts amount and both accounts when both are named", () => {
    const result = extractIntent("transfer $200 from checking to savings");
    expect(result.ok).toBe(true);
    if (result.ok && result.intent?.type === "transfer_internal") {
      expect(result.intent.amount).toBe(200);
      expect(result.intent.fromAccountId).toBe("acc-checking");
      expect(result.intent.toAccountId).toBe("acc-savings");
    }
  });

  it("fails (does not guess) when amount is missing", () => {
    const result = extractIntent("transfer from checking to savings");
    expect(result.ok).toBe(false);
  });

  it("fails (does not guess) when only one account is mentioned", () => {
    const result = extractIntent("transfer $200 from checking");
    expect(result.ok).toBe(false);
  });
});

describe("extractIntent — pay_known_payee", () => {
  it("matches a known payee name with an amount", () => {
    const result = extractIntent("pay Jane Smith $50");
    expect(result.ok).toBe(true);
    if (result.ok && result.intent?.type === "pay_known_payee") {
      expect(result.intent.payeeId).toBe("payee-jane");
      expect(result.intent.amount).toBe(50);
    }
  });

  it("fails rather than guessing when the payee is unrecognized", () => {
    const result = extractIntent("pay Someone Unknown $50");
    expect(result.ok).toBe(false);
  });
});

describe("extractIntent — no match", () => {
  it("fails cleanly on unrelated input", () => {
    const result = extractIntent("what's the weather like today");
    expect(result.ok).toBe(false);
  });
});
