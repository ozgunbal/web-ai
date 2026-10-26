import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createBrowserSpeechRecognizer, useSpeechToText, type SpeechRecognizer } from "./useSpeechToText";

/** Hand-written fake implementing SpeechRecognizer, for tests — no real browser API involved. */
class FakeSpeechRecognizer implements SpeechRecognizer {
  public startCalls = 0;
  public stopCalls = 0;
  onresult: ((transcript: string, isFinal: boolean) => void) | null = null;
  onerror: ((error: string) => void) | null = null;
  onend: (() => void) | null = null;

  start() {
    this.startCalls++;
  }
  stop() {
    this.stopCalls++;
    this.onend?.();
  }
  emitResult(transcript: string, isFinal: boolean) {
    this.onresult?.(transcript, isFinal);
  }
  emitError(error: string) {
    this.onerror?.(error);
  }
}

describe("createBrowserSpeechRecognizer", () => {
  it("returns null when no browser SpeechRecognition API exists (true in jsdom)", () => {
    expect(createBrowserSpeechRecognizer()).toBeNull();
  });
});

describe("useSpeechToText — unsupported", () => {
  it("reports isSupported: false and no-ops start/stop when no recognizer is available", () => {
    const { result } = renderHook(() => useSpeechToText({ recognizer: null }));
    expect(result.current.isSupported).toBe(false);
    expect(() => result.current.start(() => {})).not.toThrow();
    expect(() => result.current.stop()).not.toThrow();
  });
});

describe("useSpeechToText — with an injected fake recognizer", () => {
  it("starts listening and forwards interim results without stopping", () => {
    const fake = new FakeSpeechRecognizer();
    const { result } = renderHook(() => useSpeechToText({ recognizer: fake }));
    expect(result.current.isSupported).toBe(true);

    const received: { text: string; isFinal: boolean }[] = [];
    act(() => {
      result.current.start((text, isFinal) => received.push({ text, isFinal }));
    });
    expect(fake.startCalls).toBe(1);
    expect(result.current.isListening).toBe(true);

    act(() => {
      fake.emitResult("show my acc", false);
    });
    expect(received).toEqual([{ text: "show my acc", isFinal: false }]);
    expect(result.current.isListening).toBe(true);
  });

  it("stops listening once a final result is emitted", () => {
    const fake = new FakeSpeechRecognizer();
    const { result } = renderHook(() => useSpeechToText({ recognizer: fake }));

    const received: { text: string; isFinal: boolean }[] = [];
    act(() => {
      result.current.start((text, isFinal) => received.push({ text, isFinal }));
    });

    act(() => {
      fake.emitResult("show my accounts", true);
    });

    expect(received).toEqual([{ text: "show my accounts", isFinal: true }]);
    expect(fake.stopCalls).toBe(1);
    expect(result.current.isListening).toBe(false);
  });

  it("surfaces a user-facing error and stops listening on a recognition error", () => {
    const fake = new FakeSpeechRecognizer();
    const { result } = renderHook(() => useSpeechToText({ recognizer: fake }));

    act(() => {
      result.current.start(() => {});
    });
    act(() => {
      fake.emitError("not-allowed");
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.isListening).toBe(false);
  });

  it("stop() calls through to the recognizer's stop", () => {
    const fake = new FakeSpeechRecognizer();
    const { result } = renderHook(() => useSpeechToText({ recognizer: fake }));

    act(() => {
      result.current.start(() => {});
    });
    act(() => {
      result.current.stop();
    });

    expect(fake.stopCalls).toBe(1);
  });
});
