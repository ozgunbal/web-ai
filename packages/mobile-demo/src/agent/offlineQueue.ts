import AsyncStorage from "@react-native-async-storage/async-storage";
import { riskTierForIntent, type Decision, type Intent } from "@web-ai-trials/core";

const QUEUE_STORAGE_KEY = "web-ai-trials-mobile-offline-queue-v1";

export interface QueuedItem {
  id: string;
  intent: Intent;
  decision: Decision | null; // filled in once drained through the guardrail
  queuedAt: number;
}

export interface EnqueueResult {
  ok: boolean;
  reason?: string;
  item?: QueuedItem;
}

/**
 * Explicit rule, enforced in code (spec section 4.4, and section 4.4's own text:
 * "This is a real code path, not just a slide claim."): any intent with
 * riskTier !== "read_only" is REJECTED from the offline queue outright. Read-only
 * intents (list_accounts, get_transactions) queue fine; everything that moves
 * money is refused while offline, not silently queued for later.
 */
export async function enqueueIfAllowed(intent: Intent): Promise<EnqueueResult> {
  const riskTier = riskTierForIntent(intent.type);
  if (riskTier !== "read_only") {
    return {
      ok: false,
      reason: "This action requires a connection — money-movement actions cannot be queued while offline.",
    };
  }

  const item: QueuedItem = {
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intent,
    decision: null,
    queuedAt: Date.now(),
  };

  const queue = await readQueue();
  queue.push(item);
  await writeQueue(queue);
  return { ok: true, item };
}

export async function readQueue(): Promise<QueuedItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedItem[];
  } catch {
    return [];
  }
}

export async function writeQueue(queue: QueuedItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
}
