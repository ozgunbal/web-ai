import { evaluateIntent } from "../guardrail";
import type { Intent } from "../schema/intent";

const SAMPLE_INTENTS: Intent[] = [
  { type: "list_accounts", rawInputSummary: "show me my accounts" },
  {
    type: "get_transactions",
    rawInputSummary: "summarize my recent transactions",
    query: "recent",
  },
  {
    type: "transfer_internal",
    rawInputSummary: "move $500 from checking to savings",
    fromAccountId: "acc-checking",
    toAccountId: "acc-savings",
    amount: 500,
    currency: "USD",
  },
  {
    type: "transfer_internal",
    rawInputSummary: "move $5000 from checking to savings",
    fromAccountId: "acc-checking",
    toAccountId: "acc-savings",
    amount: 5000,
    currency: "USD",
  },
  {
    type: "pay_known_payee",
    rawInputSummary: "pay Jane $75",
    payeeId: "payee-jane",
    amount: 75,
  },
  {
    type: "add_payee_and_pay",
    rawInputSummary: "add a new payee named Alex and pay them $50",
    payeeName: "Alex",
    payeeAccountRef: "unknown-ref-123",
    amount: 50,
  },
  {
    type: "schedule_recurring_payment",
    rawInputSummary: "set up a $30 monthly payment to my landlord",
    payeeId: "payee-landlord",
    amount: 30,
    currency: "USD",
    frequency: "monthly",
    startDate: "2026-09-01",
  },
];

console.log("=== Guardrail demo ===\n");
for (const intent of SAMPLE_INTENTS) {
  const { decision, matchedRule } = evaluateIntent(intent);
  console.log(`Intent: ${intent.type} — "${intent.rawInputSummary}"`);
  console.log(`  Decision: ${decision}`);
  console.log(`  Matched rule: ${matchedRule.id} (${matchedRule.reason})`);
  console.log("");
}
