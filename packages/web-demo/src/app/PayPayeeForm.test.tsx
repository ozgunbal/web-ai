import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider } from "../mock-data/store";
import { PayPayeeForm } from "./PayPayeeForm";
import { PROCESSING_MS } from "./processing";
import { ToastProvider } from "./Toast";

function renderPay() {
  return render(
    <StoreProvider>
      <ToastProvider>
        <PayPayeeForm />
      </ToastProvider>
    </StoreProvider>,
  );
}

describe("PayPayeeForm — loading state and toast", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("disables the Pay button with a loader while processing, then confirms with a toast", async () => {
    const { container } = renderPay();
    const amount = container.querySelector('[data-agent-field="amount"]') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "50" } });

    fireEvent.click(screen.getByRole("button", { name: "Pay" }));

    const busyButton = screen.getByRole("button", { name: "Paying…" });
    expect((busyButton as HTMLButtonElement).disabled).toBe(true);
    expect(amount.value).toBe("50"); // the amount stays visible while the payment runs
    expect(screen.queryByText(/^Paid /)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESSING_MS);
    });

    expect((screen.getByRole("button", { name: "Pay" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Paid USD 50.00 to Jane Smith from Everyday Checking")).toBeTruthy();
    expect(amount.value).toBe("");
  });

  it("ignores a second click while the first payment is still processing", async () => {
    const { container } = renderPay();
    fireEvent.change(container.querySelector('[data-agent-field="amount"]')!, { target: { value: "20" } });
    const form = container.querySelector('[data-agent-action="pay_known_payee"]')!;

    fireEvent.submit(form);
    fireEvent.submit(form); // e.g. a programmatic resubmit; the disabled button alone wouldn't stop this

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESSING_MS);
    });
    expect(screen.getAllByText(/^Paid USD 20.00/)).toHaveLength(1);
  });
});
