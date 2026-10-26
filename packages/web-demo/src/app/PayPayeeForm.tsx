import { useState } from "react";
import { useStore } from "../mock-data/store";

export function PayPayeeForm() {
  const { state, dispatch } = useStore();
  const [mode, setMode] = useState<"known" | "new">("known");
  const [payeeId, setPayeeId] = useState(state.payees[0]?.id ?? "");
  const [payeeName, setPayeeName] = useState("");
  const [payeeAccountRef, setPayeeAccountRef] = useState("");
  const [amount, setAmount] = useState("");
  const [fromAccountId, setFromAccountId] = useState(state.accounts[0]?.id ?? "");

  return (
    <div className="card" data-tour="pay-screen">
      <h2 className="section-title">Pay a payee</h2>
      <p className="section-subtitle">
        Known payees always require confirmation. New payees are never auto-approved.
      </p>
      <div className="mode-toggle">
        <label className={`mode-pill${mode === "known" ? " active" : ""}`}>
          <input type="radio" checked={mode === "known"} onChange={() => setMode("known")} />
          Existing payee
        </label>
        <label className={`mode-pill${mode === "new" ? " active" : ""}`}>
          <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />
          New payee
        </label>
      </div>

      {mode === "known" ? (
        <form
          data-agent-action="pay_known_payee"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = Number(amount);
            if (!payeeId || !parsed) return;
            dispatch({ type: "PAY_PAYEE", payeeId, amount: parsed, fromAccountId });
            setAmount("");
          }}
        >
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
            <label className="field-label">Payee</label>
            <select
              className="field-select"
              data-agent-field="payeeId"
              value={payeeId}
              onChange={(e) => setPayeeId(e.target.value)}
            >
              {state.payees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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
          <button type="submit" className="btn-primary" data-agent-submit="pay_known_payee">
            Pay
          </button>
        </form>
      ) : (
        <form
          data-agent-action="add_payee_and_pay"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = Number(amount);
            if (!payeeName || !payeeAccountRef || !parsed) return;
            dispatch({ type: "ADD_PAYEE_AND_PAY", payeeName, payeeAccountRef, amount: parsed, fromAccountId });
            setPayeeName("");
            setPayeeAccountRef("");
            setAmount("");
          }}
        >
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
            <label className="field-label">New payee name</label>
            <input
              className="field-input"
              data-agent-field="payeeName"
              value={payeeName}
              onChange={(e) => setPayeeName(e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Payee account reference</label>
            <input
              className="field-input"
              data-agent-field="payeeAccountRef"
              value={payeeAccountRef}
              onChange={(e) => setPayeeAccountRef(e.target.value)}
            />
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
          <button type="submit" className="btn-primary" data-agent-submit="add_payee_and_pay">
            Add payee and pay
          </button>
        </form>
      )}
    </div>
  );
}
