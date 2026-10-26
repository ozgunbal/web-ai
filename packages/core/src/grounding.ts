import type { Intent } from "./schema/intent";

/**
 * Grounding: the step between "the model produced a schema-valid intent" and
 * "the guardrail decides". The model never reliably knows real ids (measured:
 * it emits "checking", "Everyday Checking", 12345, "attacker"), so code maps
 * its references onto the user's real accounts/payees and checks the result
 * against real data. Anything that doesn't map is never passed on.
 *
 * This is also where the policy's "same owner" condition is actually
 * enforced: an internal transfer to an account that isn't the user's is
 * rejected here, before the amount-only guardrail predicate ever runs.
 */

export interface GroundingAccount {
  id: string;
  name: string;
  type: string;
  balance?: number;
}

export interface GroundingPayee {
  id: string;
  name: string;
}

export interface UserContext {
  accounts: readonly GroundingAccount[];
  payees: readonly GroundingPayee[];
}

export type RefMatch = "exact_id" | "resolved" | "ungrounded";

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/**
 * Exact id > exact name > a distinctive name word ("joint", "everyday") >
 * account type ("savings" -> first savings account). Numbers, empty strings
 * and names of things the user doesn't own stay ungrounded.
 */
export function resolveAccount(ref: unknown, ctx: UserContext): { id: string | null; match: RefMatch } {
  if (typeof ref !== "string" || ref.trim() === "") return { id: null, match: "ungrounded" };
  const lower = ref.trim().toLowerCase();
  const byId = ctx.accounts.find((a) => a.id.toLowerCase() === lower);
  if (byId) return { id: byId.id, match: "exact_id" };
  const byName = ctx.accounts.find((a) => a.name.toLowerCase() === lower);
  if (byName) return { id: byName.id, match: "resolved" };

  const refWords = words(lower);
  const distinctive = ctx.accounts.filter((a) =>
    words(a.name).some((w) => !a.type.toLowerCase().startsWith(w.replace(/s$/, "")) && refWords.includes(w)),
  );
  if (distinctive.length === 1) return { id: distinctive[0]!.id, match: "resolved" };

  const byType = ctx.accounts.find((a) => refWords.some((w) => w.replace(/s$/, "") === a.type.toLowerCase().replace(/s$/, "")));
  if (byType) return { id: byType.id, match: "resolved" };
  return { id: null, match: "ungrounded" };
}

export function resolvePayee(ref: unknown, ctx: UserContext): { id: string | null; match: RefMatch } {
  if (typeof ref !== "string" || ref.trim() === "") return { id: null, match: "ungrounded" };
  const lower = ref.trim().toLowerCase();
  const byId = ctx.payees.find((p) => p.id.toLowerCase() === lower);
  if (byId) return { id: byId.id, match: "exact_id" };
  const refWords = words(lower);
  const byName = ctx.payees.filter(
    (p) => p.name.toLowerCase() === lower || words(p.name).some((w) => refWords.includes(w)),
  );
  if (byName.length === 1) return { id: byName[0]!.id, match: "resolved" };
  return { id: null, match: "ungrounded" };
}

export type GroundingOutcome =
  | { status: "ok"; intent: Intent; match: RefMatch | null }
  | { status: "needs_clarification"; intent: Intent; missing: string[]; question: string }
  | { status: "rejected"; intent: Intent; reason: string };

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

function worstMatch(matches: RefMatch[]): RefMatch | null {
  if (matches.length === 0) return null;
  return matches.includes("resolved") ? "resolved" : "exact_id";
}

export function groundIntent(intent: Intent, ctx: UserContext): GroundingOutcome {
  switch (intent.type) {
    case "need_clarification":
      return {
        status: "needs_clarification",
        intent,
        missing: intent.missing,
        question: intent.question || "Could you give me a bit more detail?",
      };

    case "transfer_internal": {
      const missing = (["fromAccountId", "toAccountId"] as const).filter((k) => isBlank(intent[k]));
      if (missing.length > 0) {
        return { status: "needs_clarification", intent, missing, question: "Which accounts should I move money between?" };
      }
      const from = resolveAccount(intent.fromAccountId, ctx);
      const to = resolveAccount(intent.toAccountId, ctx);
      for (const [field, r] of [["fromAccountId", from], ["toAccountId", to]] as const) {
        if (!r.id) {
          return {
            status: "rejected",
            intent,
            reason: `${field} "${intent[field]}" is not one of your accounts. Internal transfers only move money between your own accounts.`,
          };
        }
      }
      if (from.id === to.id) return { status: "rejected", intent, reason: "The source and destination are the same account." };
      const balance = ctx.accounts.find((a) => a.id === from.id)?.balance;
      if (balance !== undefined && intent.amount > balance) {
        return { status: "rejected", intent, reason: `Amount ${intent.amount} exceeds the available balance of ${balance}.` };
      }
      return {
        status: "ok",
        intent: { ...intent, fromAccountId: from.id!, toAccountId: to.id! },
        match: worstMatch([from.match, to.match]),
      };
    }

    case "pay_known_payee":
    case "schedule_recurring_payment": {
      const payee = resolvePayee(intent.payeeId, ctx);
      if (!payee.id) {
        return {
          status: "needs_clarification",
          intent,
          missing: ["payeeId"],
          question: isBlank(intent.payeeId)
            ? "Who should I pay?"
            : `"${intent.payeeId}" isn't one of your saved payees. Do you want to add them as a new payee?`,
        };
      }
      return { status: "ok", intent: { ...intent, payeeId: payee.id }, match: payee.match };
    }

    case "get_transactions": {
      if (isBlank(intent.accountId)) return { status: "ok", intent, match: null };
      const account = resolveAccount(intent.accountId, ctx);
      // A read-only filter that doesn't map is dropped rather than failing the whole request.
      return { status: "ok", intent: { ...intent, accountId: account.id ?? undefined }, match: account.match };
    }

    case "add_payee_and_pay":
      if (isBlank(intent.payeeName)) {
        return { status: "needs_clarification", intent, missing: ["payeeName"], question: "Who is the new payee?" };
      }
      return { status: "ok", intent, match: null };

    default:
      return { status: "ok", intent, match: null };
  }
}
