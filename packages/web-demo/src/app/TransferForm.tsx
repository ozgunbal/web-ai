import { useState } from "react";
import { useStore } from "../mock-data/store";

export function TransferForm() {
  const { state, dispatch } = useStore();
  const [fromAccountId, setFromAccountId] = useState(state.accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(state.accounts[1]?.id ?? "");
  const [amount, setAmount] = useState("");

  return (
    <form
      className="card"
      data-agent-action="transfer_internal"
      data-tour="transfer-screen"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = Number(amount);
        if (!fromAccountId || !toAccountId || !parsed) return;
        dispatch({ type: "TRANSFER_INTERNAL", fromAccountId, toAccountId, amount: parsed });
        setAmount("");
      }}
    >
      <h2 className="section-title">Transfer between my accounts</h2>
      <p className="section-subtitle">
        Amounts up to $1,000 auto-execute. Above that, the agent will ask you to confirm.
      </p>
      <div className="field-group">
        <label className="field-label">From</label>
        <select
          className="field-select"
          data-agent-field="fromAccountId"
          value={fromAccountId}
          onChange={(e) => setFromAccountId(e.target.value)}
        >
          {state.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-group">
        <label className="field-label">To</label>
        <select
          className="field-select"
          data-agent-field="toAccountId"
          value={toAccountId}
          onChange={(e) => setToAccountId(e.target.value)}
        >
          {state.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-group">
        <label className="field-label">Amount</label>
        <input
          className="field-input"
          data-agent-field="amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <button type="submit" className="btn-primary" data-agent-submit="transfer_internal">
        Transfer
      </button>
    </form>
  );
}
