import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeIntent, SUBMIT_DELAY_MS } from "./executeIntent";
import { availableActionsOnScreen } from "./domAdapter";

function setDom(html: string) {
  document.body.innerHTML = html;
}

describe("domAdapter — availableActionsOnScreen", () => {
  afterEach(() => setDom(""));

  it("finds every distinct data-agent-action on the current screen", () => {
    setDom(`
      <section data-agent-action="list_accounts"></section>
      <form data-agent-action="transfer_internal"></form>
    `);
    const actions = availableActionsOnScreen();
    expect(actions.sort()).toEqual(["list_accounts", "transfer_internal"]);
  });
});

describe("executeIntent — transfer_internal", () => {
  beforeEach(() => {
    setDom(`
      <form data-agent-action="transfer_internal">
        <select data-agent-field="fromAccountId">
          <option value="acc-checking">Checking</option>
          <option value="acc-savings">Savings</option>
        </select>
        <select data-agent-field="toAccountId">
          <option value="acc-checking">Checking</option>
          <option value="acc-savings">Savings</option>
        </select>
        <input data-agent-field="amount" />
        <button type="submit" data-agent-submit="transfer_internal">Transfer</button>
      </form>
    `);
  });
  afterEach(() => setDom(""));

  const transfer = {
    type: "transfer_internal" as const,
    rawInputSummary: "transfer",
    fromAccountId: "acc-savings",
    toAccountId: "acc-checking",
    amount: 250,
    currency: "USD",
  };
  const amountInput = () => document.querySelector('[data-agent-field="amount"]') as HTMLInputElement;
  const submitButton = () => document.querySelector('[data-agent-submit="transfer_internal"]')!;

  it("fills fields and clicks submit for a matching intent", async () => {
    let submitted = false;
    submitButton().addEventListener("click", () => {
      submitted = true;
    });

    const result = await executeIntent(transfer, document, { submitDelayMs: 0 });

    expect(result.ok).toBe(true);
    expect(submitted).toBe(true);
    expect(amountInput().value).toBe("250");
    expect((document.querySelector('[data-agent-field="fromAccountId"]') as HTMLSelectElement).value).toBe(
      "acc-savings",
    );
  });

  it("keeps the filled values visible before submitting, even for a form that clears itself on submit", async () => {
    // Regression: TransferForm/PayPayeeForm reset their amount after submit. Filling and
    // submitting in the same tick meant the typed amount was never visible on screen.
    vi.useFakeTimers();
    let submitted = false;
    submitButton().addEventListener("click", () => {
      submitted = true;
      amountInput().value = "";
    });

    const pending = executeIntent(transfer);
    expect(amountInput().value).toBe("250");
    expect(submitted).toBe(false);

    await vi.advanceTimersByTimeAsync(SUBMIT_DELAY_MS);
    expect(await pending).toEqual({ ok: true });
    expect(submitted).toBe(true);
    vi.useRealTimers();
  });

  it("visually marks the fields it filled, then the submit it clicked, as agent-touched", async () => {
    vi.useFakeTimers();
    const pending = executeIntent(transfer);

    expect(amountInput().classList.contains("agent-touched")).toBe(true);
    expect(submitButton().classList.contains("agent-touched")).toBe(false);

    await vi.advanceTimersByTimeAsync(SUBMIT_DELAY_MS);
    await pending;
    expect(submitButton().classList.contains("agent-touched")).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);
    expect(amountInput().classList.contains("agent-touched")).toBe(false);
    vi.useRealTimers();
  });

  it("does not submit if the form disappears while the agent is pausing", async () => {
    vi.useFakeTimers();
    let submitted = false;
    submitButton().addEventListener("click", () => {
      submitted = true;
    });
    const pending = executeIntent(transfer);
    setDom(""); // user navigated away

    await vi.advanceTimersByTimeAsync(SUBMIT_DELAY_MS);
    expect((await pending).ok).toBe(false);
    expect(submitted).toBe(false);
    vi.useRealTimers();
  });

  it("returns a failure result when no matching container exists on screen", async () => {
    setDom(""); // clear the form
    const result = await executeIntent(transfer);
    expect(result.ok).toBe(false);
  });
});

describe("executeIntent — read-only action with no submit button", () => {
  beforeEach(() => setDom(`<section data-agent-action="list_accounts"></section>`));
  afterEach(() => setDom(""));

  it("succeeds without requiring a click, since read-only screens have no submit button", async () => {
    const result = await executeIntent({ type: "list_accounts", rawInputSummary: "show accounts" });
    expect(result.ok).toBe(true);
  });

  it("highlights the whole container so it's obvious where the answer is", async () => {
    vi.useFakeTimers();
    await executeIntent({ type: "list_accounts", rawInputSummary: "show accounts" });
    const container = document.querySelector('[data-agent-action="list_accounts"]')!;
    expect(container.classList.contains("agent-highlight")).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(container.classList.contains("agent-highlight")).toBe(false);
    vi.useRealTimers();
  });
});
