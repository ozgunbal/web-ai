import { evaluateIntent, type Decision } from "@web-ai-trials/core";
import { readQueue, writeQueue, type QueuedItem } from "./offlineQueue";

export interface DrainResultItem {
  item: QueuedItem;
  decision: Decision;
  executed: boolean; // true only for "allow" — "confirm" items are surfaced, not auto-executed
}

/**
 * On reconnect: drain the queue through the NORMAL guardrail path — spec section
 * 4.4: "not a bypass." Every queued item is re-evaluated via evaluateIntent()
 * fresh (never a cached decision), in FIFO order.
 *
 * Chosen UX (documented per plan's own instruction to "decide and document"):
 * - "allow" decisions execute immediately and are removed from the queue.
 * - "confirm" decisions are surfaced to the user and RETAINED in the queue until
 *   the user acts on them (removed by the caller once confirmed/cancelled) —
 *   this avoids silently dropping a pending confirmation the user never saw.
 * - "block" decisions are removed from the queue and surfaced as rejected (queued
 *   read-only intents should never actually hit "block" given current policy, but
 *   handled defensively).
 */
export async function drainQueueOnReconnect(): Promise<DrainResultItem[]> {
  const queue = await readQueue();
  const results: DrainResultItem[] = [];
  const remaining: QueuedItem[] = [];

  for (const item of queue) {
    const { decision } = evaluateIntent(item.intent);
    if (decision === "allow") {
      results.push({ item: { ...item, decision }, decision, executed: true });
      // executed — not retained in queue
    } else if (decision === "confirm") {
      const updated = { ...item, decision };
      results.push({ item: updated, decision, executed: false });
      remaining.push(updated); // retained until user confirms/cancels
    } else {
      results.push({ item: { ...item, decision }, decision, executed: false });
      // block — dropped, not retained
    }
  }

  await writeQueue(remaining);
  return results;
}
