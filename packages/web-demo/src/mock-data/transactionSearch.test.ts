import { describe, expect, it } from "vitest";
import type { Transaction } from "@web-ai-trials/shared";
import { matchesQuery } from "./transactionSearch";
import { SEED_TRANSACTIONS } from "./transactions";
import { INJECTED_TRANSACTION_ID, INJECTED_NOTE_TEXT } from "../injection-scenario/fixture";

const coffee: Transaction = {
  id: "t1",
  accountId: "acc-1",
  date: "2026-08-20",
  description: "Coffee Shop",
  amount: -4.75,
  category: "food_drink",
};

describe("matchesQuery", () => {
  it("matches on an empty query (no filter applied)", () => {
    expect(matchesQuery(coffee, "")).toBe(true);
    expect(matchesQuery(coffee, "   ")).toBe(true);
  });

  it("matches a literal substring of the description (existing behavior preserved)", () => {
    expect(matchesQuery(coffee, "coffee")).toBe(true);
    expect(matchesQuery(coffee, "Coffee Shop")).toBe(true);
  });

  it("matches a literal substring of the category name", () => {
    expect(matchesQuery(coffee, "food_drink")).toBe(true);
  });

  it("reproduces the real-world fix: 'what did I spend on drinking and eating' matches Coffee Shop", () => {
    expect(matchesQuery(coffee, "what did i spend on drinking and eating")).toBe(true);
  });

  it("matches a clean single-word category synonym", () => {
    expect(matchesQuery(coffee, "food")).toBe(true);
    expect(matchesQuery(coffee, "restaurant")).toBe(true);
  });

  it("does not match an unrelated query", () => {
    expect(matchesQuery(coffee, "rent")).toBe(false);
    expect(matchesQuery(coffee, "utilities")).toBe(false);
  });

  it("matches across all seeded categories via their synonyms", () => {
    const grocery = SEED_TRANSACTIONS.find((t) => t.description === "Grocery Store")!;
    const electric = SEED_TRANSACTIONS.find((t) => t.description === "Electric Bill")!;
    const rent = SEED_TRANSACTIONS.find((t) => t.description === "Rent Split")!;
    const paycheck = SEED_TRANSACTIONS.find((t) => t.description === "Paycheck")!;

    expect(matchesQuery(grocery, "groceries")).toBe(true);
    expect(matchesQuery(electric, "bills")).toBe(true);
    expect(matchesQuery(rent, "housing")).toBe(true);
    expect(matchesQuery(paycheck, "salary")).toBe(true);
  });

  it("leaves the injection-scenario fixture transaction's identity untouched", () => {
    const injected = SEED_TRANSACTIONS.find((t) => t.id === INJECTED_TRANSACTION_ID)!;
    expect(injected.note).toBe(INJECTED_NOTE_TEXT);
    expect(injected.description).toBe("Online Transfer Note");
    expect(injected.category).toBe("transfer");
  });
});
