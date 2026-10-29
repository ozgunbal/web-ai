import { enqueueIfAllowed, readQueue, clearQueue } from "./offlineQueue";
import { drainQueueOnReconnect } from "./reconnectDrain";
import type { Intent } from "@web-ai/core";

beforeEach(async () => {
  await clearQueue();
});

describe("drainQueueOnReconnect", () => {
  it("executes read-only ('allow') items and removes them from the queue", async () => {
    await enqueueIfAllowed({ type: "list_accounts", rawInputSummary: "show accounts" });
    await enqueueIfAllowed({ type: "get_transactions", rawInputSummary: "recent" });

    const results = await drainQueueOnReconnect();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.decision === "allow" && r.executed)).toBe(true);

    const remaining = await readQueue();
    expect(remaining).toHaveLength(0);
  });

  it("re-evaluates each item through the real guardrail (not a cached decision)", async () => {
    // Read-only intents always queue as decision:null; draining must compute a
    // FRESH decision via evaluateIntent, not reuse a stale/cached value.
    await enqueueIfAllowed({ type: "list_accounts", rawInputSummary: "show accounts" });
    const results = await drainQueueOnReconnect();
    expect(results[0]?.decision).toBe("allow");
  });

  it("processes items in FIFO order", async () => {
    await enqueueIfAllowed({ type: "list_accounts", rawInputSummary: "first" });
    await enqueueIfAllowed({ type: "get_transactions", rawInputSummary: "second" });
    const results = await drainQueueOnReconnect();
    expect(results[0]?.item.intent.rawInputSummary).toBe("first");
    expect(results[1]?.item.intent.rawInputSummary).toBe("second");
  });

  it("leaves the queue empty when there is nothing queued", async () => {
    const results = await drainQueueOnReconnect();
    expect(results).toHaveLength(0);
  });
});
