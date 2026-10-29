import type { Intent } from "@web-ai/core";
import { SEED_ACCOUNTS, SEED_PAYEES } from "../mock-data/accounts";

/**
 * Simplified keyword/slot-based intent extractor for mobile (spec section 4.1 /
 * Section 7 scope-down — NOT a real local LLM). Outputs the SAME core `Intent`
 * type as the web WebLLM-based parser, validated through the same zod schema —
 * this is the key architectural point: mobile and web converge on one Intent
 * contract even though parsing methods differ completely.
 */
export interface SlotExtractionResult {
  ok: boolean;
  intent?: Intent;
  reason?: string;
}

function findAccountIdByName(text: string): string | undefined {
  const lower = text.toLowerCase();
  return SEED_ACCOUNTS.find(
    (a) => lower.includes(a.name.toLowerCase()) || lower.includes(a.type.toLowerCase()),
  )?.id;
}

function findPayeeIdByName(text: string): string | undefined {
  const lower = text.toLowerCase();
  return SEED_PAYEES.find((p) => lower.includes(p.name.toLowerCase()))?.id;
}

function extractAmount(text: string): number | undefined {
  const match = text.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function extractIntent(text: string): SlotExtractionResult {
  const lower = text.toLowerCase();

  if (/\b(show|list|view)\b.*\baccounts?\b/.test(lower) || /\bmy accounts\b/.test(lower)) {
    return { ok: true, intent: { type: "list_accounts", rawInputSummary: text } };
  }

  if (/\b(transactions?|history|spending)\b/.test(lower)) {
    return { ok: true, intent: { type: "get_transactions", rawInputSummary: text } };
  }

  if (/\btransfer\b|\bmove\b.*\bmoney\b/.test(lower)) {
    const amount = extractAmount(text);
    // naive two-account detection: look for two distinct account references
    const accountMentions = SEED_ACCOUNTS.filter(
      (a) => lower.includes(a.name.toLowerCase()) || lower.includes(a.type.toLowerCase()),
    );
    if (!amount || accountMentions.length < 2) {
      return { ok: false, reason: "Could not confidently extract both accounts and an amount for a transfer." };
    }
    return {
      ok: true,
      intent: {
        type: "transfer_internal",
        rawInputSummary: text,
        fromAccountId: accountMentions[0]!.id,
        toAccountId: accountMentions[1]!.id,
        amount,
        currency: "USD",
      },
    };
  }

  if (/\bpay\b/.test(lower)) {
    const amount = extractAmount(text);
    const payeeId = findPayeeIdByName(text);
    if (!amount) {
      return { ok: false, reason: "Could not confidently extract an amount to pay." };
    }
    if (payeeId) {
      return {
        ok: true,
        intent: { type: "pay_known_payee", rawInputSummary: text, payeeId, amount },
      };
    }
    // "pay <someone not in the known payee list>" — treat as add_payee_and_pay,
    // but without a real account reference the slot extractor cannot fill
    // payeeAccountRef confidently, so this correctly fails to produce a valid
    // intent rather than guessing — matches spec's "reject rather than fix" stance.
    return {
      ok: false,
      reason: "Payee not recognized and no account reference given — cannot safely construct add_payee_and_pay.",
    };
  }

  return { ok: false, reason: "No known action keyword matched this input." };
}
