import { createContext, useContext, useReducer, type ReactNode } from "react";
import type { Account, Transaction, Payee } from "@web-ai-trials/shared";
import { SEED_ACCOUNTS } from "./accounts";
import { SEED_TRANSACTIONS } from "./transactions";
import { SEED_PAYEES } from "./payees";

interface StoreState {
  accounts: Account[];
  transactions: Transaction[];
  payees: Payee[];
}

type StoreAction =
  | { type: "TRANSFER_INTERNAL"; fromAccountId: string; toAccountId: string; amount: number }
  | { type: "PAY_PAYEE"; payeeId: string; amount: number; fromAccountId: string }
  | { type: "ADD_PAYEE_AND_PAY"; payeeName: string; payeeAccountRef: string; amount: number; fromAccountId: string }
  | { type: "RESET" };

const STORAGE_KEY = "web-ai-trials-store-v1";

function loadInitialState(): StoreState {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as StoreState;
    } catch {
      // fall through to seed defaults
    }
  }
  return { accounts: SEED_ACCOUNTS, transactions: SEED_TRANSACTIONS, payees: SEED_PAYEES };
}

function persist(state: StoreState) {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore quota/serialization errors — demo-only persistence
    }
  }
}

function reducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case "TRANSFER_INTERNAL": {
      const next = {
        ...state,
        accounts: state.accounts.map((a) => {
          if (a.id === action.fromAccountId) return { ...a, balance: a.balance - action.amount };
          if (a.id === action.toAccountId) return { ...a, balance: a.balance + action.amount };
          return a;
        }),
        transactions: [
          {
            id: `txn-${Date.now()}`,
            accountId: action.fromAccountId,
            date: new Date().toISOString().slice(0, 10),
            description: `Transfer to ${action.toAccountId}`,
            amount: -action.amount,
            category: "transfer" as const,
          },
          ...state.transactions,
        ],
      };
      persist(next);
      return next;
    }
    case "PAY_PAYEE": {
      const next = {
        ...state,
        accounts: state.accounts.map((a) =>
          a.id === action.fromAccountId ? { ...a, balance: a.balance - action.amount } : a,
        ),
        transactions: [
          {
            id: `txn-${Date.now()}`,
            accountId: action.fromAccountId,
            date: new Date().toISOString().slice(0, 10),
            description: `Payment to ${action.payeeId}`,
            amount: -action.amount,
            category: "transfer" as const,
          },
          ...state.transactions,
        ],
      };
      persist(next);
      return next;
    }
    case "ADD_PAYEE_AND_PAY": {
      const newPayeeId = `payee-${Date.now()}`;
      const next = {
        ...state,
        payees: [...state.payees, { id: newPayeeId, name: action.payeeName, accountRef: action.payeeAccountRef }],
        accounts: state.accounts.map((a) =>
          a.id === action.fromAccountId ? { ...a, balance: a.balance - action.amount } : a,
        ),
        transactions: [
          {
            id: `txn-${Date.now()}`,
            accountId: action.fromAccountId,
            date: new Date().toISOString().slice(0, 10),
            description: `Payment to new payee ${action.payeeName}`,
            amount: -action.amount,
            category: "transfer" as const,
          },
          ...state.transactions,
        ],
      };
      persist(next);
      return next;
    }
    case "RESET": {
      const next = { accounts: SEED_ACCOUNTS, transactions: SEED_TRANSACTIONS, payees: SEED_PAYEES };
      persist(next);
      return next;
    }
  }
}

const StoreContext = createContext<{ state: StoreState; dispatch: React.Dispatch<StoreAction> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);
  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
