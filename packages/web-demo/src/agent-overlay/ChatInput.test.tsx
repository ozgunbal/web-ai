import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpeechRecognizer } from "./useSpeechToText";

class FakeSpeechRecognizer implements SpeechRecognizer {
  onresult: ((transcript: string, isFinal: boolean) => void) | null = null;
  onerror: ((error: string) => void) | null = null;
  onend: (() => void) | null = null;
  start() {}
  stop() {
    this.onend?.();
  }
  emitResult(transcript: string, isFinal: boolean) {
    this.onresult?.(transcript, isFinal);
  }
}

let currentRecognizer: FakeSpeechRecognizer | null = new FakeSpeechRecognizer();

vi.mock("./useSpeechToText", async () => {
  const actual = await vi.importActual<typeof import("./useSpeechToText")>("./useSpeechToText");
  return {
    ...actual,
    useSpeechToText: (options?: { recognizer?: SpeechRecognizer | null }) =>
      actual.useSpeechToText({ recognizer: options?.recognizer !== undefined ? options.recognizer : currentRecognizer }),
  };
});

import { ChatInput } from "./ChatInput";

afterEach(() => cleanup());

describe("ChatInput — typed input (regression)", () => {
  it("submits typed text and clears the input", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByLabelText("agent-chat-input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "show me my accounts" } });
    fireEvent.submit(input.closest("form")!);

    expect(onSend).toHaveBeenCalledWith("show me my accounts");
    expect(input.value).toBe("");
  });
});

describe("ChatInput — voice input", () => {
  it("renders a mic button when speech recognition is supported", () => {
    currentRecognizer = new FakeSpeechRecognizer();
    render(<ChatInput onSend={vi.fn()} />);
    expect(screen.getByTestId("agent-mic-btn")).toBeTruthy();
  });

  it("does not render a mic button when speech recognition is unsupported", () => {
    currentRecognizer = null;
    render(<ChatInput onSend={vi.fn()} />);
    expect(screen.queryByTestId("agent-mic-btn")).toBeNull();
  });

  it("populates the text input from a final transcript without auto-sending", () => {
    const fake = new FakeSpeechRecognizer();
    currentRecognizer = fake;
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    fireEvent.click(screen.getByTestId("agent-mic-btn"));
    act(() => {
      fake.emitResult("transfer two hundred dollars", true);
    });

    const input = screen.getByLabelText("agent-chat-input") as HTMLInputElement;
    expect(input.value).toBe("transfer two hundred dollars");
    // Never auto-sent — the user must still submit.
    expect(onSend).not.toHaveBeenCalled();
  });
});
