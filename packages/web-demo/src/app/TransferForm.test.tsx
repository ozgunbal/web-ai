import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider } from "../mock-data/store";
import { PROCESSING_MS } from "./processing";
import { ToastProvider } from "./Toast";
import { TransferForm } from "./TransferForm";

describe("TransferForm — loading state and toast", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("disables the Transfer button with a loader while processing, then confirms with a toast", async () => {
    const { container } = render(
      <StoreProvider>
        <ToastProvider>
          <TransferForm />
        </ToastProvider>
      </StoreProvider>,
    );
    const amount = container.querySelector('[data-agent-field="amount"]') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "75" } });

    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));

    expect((screen.getByRole("button", { name: "Transferring…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(amount.value).toBe("75");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROCESSING_MS);
    });

    expect((screen.getByRole("button", { name: "Transfer" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Moved USD 75.00 from Everyday Checking to High-Yield Savings")).toBeTruthy();
    expect(amount.value).toBe("");
  });
});
