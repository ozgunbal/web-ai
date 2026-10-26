import type { Account, Payee } from "@web-ai-trials/shared";

// Mirrors web-demo's mock-data shape via @web-ai-trials/shared DTOs for consistency
// (spec doesn't require the two apps' seed data to be identical, but keeping the
// account/payee ids aligned makes cross-referencing the demo scripts easier).
export const SEED_ACCOUNTS: Account[] = [
  { id: "acc-checking", name: "Everyday Checking", type: "checking", balance: 4230.55, currency: "USD" },
  { id: "acc-savings", name: "High-Yield Savings", type: "savings", balance: 18500.0, currency: "USD" },
];

export const SEED_PAYEES: Payee[] = [{ id: "payee-jane", name: "Jane Smith", accountRef: "external-ref-jane-001" }];
