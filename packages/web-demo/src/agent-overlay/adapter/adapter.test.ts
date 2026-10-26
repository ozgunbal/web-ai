import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeIntent } from "./executeIntent";
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

  it("fills fields and clicks submit for a matching intent", () => {
    let submitted = false;
    document.querySelector('[data-agent-submit="transfer_internal"]')!.addEventListener("click", () => {
      submitted = true;
    });

    const result = executeIntent({
      type: "transfer_internal",
      rawInputSummary: "transfer",
      fromAccountId: "acc-savings",
      toAccountId: "acc-checking",
      amount: 250,
      currency: "USD",
    });

    expect(result.ok).toBe(true);
    expect(submitted).toBe(true);
    expect((document.querySelector('[data-agent-field="amount"]') as HTMLInputElement).value).toBe("250");
    expect((document.querySelector('[data-agent-field="fromAccountId"]') as HTMLSelectElement).value).toBe(
      "acc-savings",
    );
  });

  it("visually marks the fields it filled and the submit it clicked as agent-touched", () => {
    vi.useFakeTimers();
    executeIntent({
      type: "transfer_internal",
      rawInputSummary: "transfer",
      fromAccountId: "acc-savings",
      toAccountId: "acc-checking",
      amount: 250,
      currency: "USD",
    });

    expect(document.querySelector('[data-agent-field="amount"]')!.classList.contains("agent-touched")).toBe(true);
    expect(document.querySelector('[data-agent-submit="transfer_internal"]')!.classList.contains("agent-touched")).toBe(
      true,
    );

    vi.advanceTimersByTime(3000);
    expect(document.querySelector('[data-agent-field="amount"]')!.classList.contains("agent-touched")).toBe(false);
    vi.useRealTimers();
  });

  it("returns a failure result when no matching container exists on screen", () => {
    setDom(""); // clear the form
    const result = executeIntent({
      type: "transfer_internal",
      rawInputSummary: "transfer",
      fromAccountId: "acc-savings",
      toAccountId: "acc-checking",
      amount: 250,
      currency: "USD",
    });
    expect(result.ok).toBe(false);
  });
});

describe("executeIntent — read-only action with no submit button", () => {
  beforeEach(() => setDom(`<section data-agent-action="list_accounts"></section>`));
  afterEach(() => setDom(""));

  it("succeeds without requiring a click, since read-only screens have no submit button", () => {
    const result = executeIntent({ type: "list_accounts", rawInputSummary: "show accounts" });
    expect(result.ok).toBe(true);
  });

  it("highlights the whole container so it's obvious where the answer is", () => {
    vi.useFakeTimers();
    executeIntent({ type: "list_accounts", rawInputSummary: "show accounts" });
    const container = document.querySelector('[data-agent-action="list_accounts"]')!;
    expect(container.classList.contains("agent-highlight")).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(container.classList.contains("agent-highlight")).toBe(false);
    vi.useRealTimers();
  });
});
