import AsyncStorage from "@react-native-async-storage/async-storage";
import { enqueueIfAllowed, readQueue, clearQueue } from "./offlineQueue";
import type { Intent } from "@web-ai/core";

const readOnlyIntent: Intent = { type: "list_accounts", rawInputSummary: "show accounts" };
const moneyMovementIntent: Intent = {
  type: "transfer_internal",
  rawInputSummary: "transfer",
  fromAccountId: "acc-checking",
  toAccountId: "acc-savings",
  amount: 100,
  currency: "USD",
};

beforeEach(async () => {
  await clearQueue();
});

describe("enqueueIfAllowed", () => {
  it("queues a read-only intent successfully", async () => {
    const result = await enqueueIfAllowed(readOnlyIntent);
    expect(result.ok).toBe(true);
    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.intent.type).toBe("list_accounts");
    expect(queue[0]?.decision).toBeNull();
  });

  it("rejects a money-movement intent outright — not just a UI message, a real enforced code path", async () => {
    const result = await enqueueIfAllowed(moneyMovementIntent);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/requires a connection/i);
    const queue = await readQueue();
    expect(queue).toHaveLength(0); // nothing was queued
  });

  it("rejects add_payee_and_pay (high_risk) the same way", async () => {
    const intent: Intent = {
      type: "add_payee_and_pay",
      rawInputSummary: "add and pay",
      payeeName: "Alex",
      payeeAccountRef: "ref",
      amount: 20,
    };
    const result = await enqueueIfAllowed(intent);
    expect(result.ok).toBe(false);
  });

  it("persists queued items across reads via AsyncStorage", async () => {
    await enqueueIfAllowed(readOnlyIntent);
    await enqueueIfAllowed({ type: "get_transactions", rawInputSummary: "recent" });
    const queue = await readQueue();
    expect(queue).toHaveLength(2);
    const rawStored = await AsyncStorage.getItem("web-ai-mobile-offline-queue-v1");
    expect(rawStored).not.toBeNull();
  });
});
