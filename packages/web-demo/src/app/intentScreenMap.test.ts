import { describe, expect, it } from "vitest";
import { INTENT_SCREEN_MAP } from "./intentScreenMap";
import { IntentType } from "@web-ai-trials/core";

describe("INTENT_SCREEN_MAP", () => {
  it("maps every real IntentType enum value to a screen or null", () => {
    // Guards against drift: if a new intent type is added to the core schema
    // without updating this map, TypeScript's Record<IntentType, ...> would
    // already catch a missing key at compile time — this test additionally
    // confirms every value is one of the real Nav screens or explicitly null.
    const validScreens = new Set(["accounts", "transactions", "transfer", "pay", null]);
    for (const type of IntentType.options) {
      expect(validScreens.has(INTENT_SCREEN_MAP[type])).toBe(true);
    }
  });

  it("maps list_accounts to the accounts screen", () => {
    expect(INTENT_SCREEN_MAP.list_accounts).toBe("accounts");
  });

  it("maps both payee-related intents to the pay screen", () => {
    expect(INTENT_SCREEN_MAP.pay_known_payee).toBe("pay");
    expect(INTENT_SCREEN_MAP.add_payee_and_pay).toBe("pay");
  });

  it("maps schedule_recurring_payment to null (no screen built for it yet)", () => {
    // Real, disclosed gap — see App.tsx / demo-script.md: there is no UI for
    // this action, so the agent must report that distinctly rather than
    // failing with a confusing "element not found" message.
    expect(INTENT_SCREEN_MAP.schedule_recurring_payment).toBeNull();
  });
});
