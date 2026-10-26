import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createBrowserSpeechSynthesizer, useTextToSpeech, type SpeechSynthesizer } from "./useTextToSpeech";
import type { AgentMessage } from "./useAgentSession";

class FakeSpeechSynthesizer implements SpeechSynthesizer {
  public spoken: string[] = [];
  public cancelCalls = 0;
  speak(text: string) {
    this.spoken.push(text);
  }
  cancel() {
    this.cancelCalls++;
  }
}

function agentMsg(id: string, text: string): AgentMessage {
  return { id, role: "agent", text };
}
function userMsg(id: string, text: string): AgentMessage {
  return { id, role: "user", text };
}

describe("createBrowserSpeechSynthesizer", () => {
  it("returns null when no browser speechSynthesis API exists (true in jsdom)", () => {
    expect(createBrowserSpeechSynthesizer()).toBeNull();
  });
});

describe("useTextToSpeech", () => {
  it("reports isSupported: false and stays disabled when no synthesizer is available", () => {
    const { result } = renderHook(() => useTextToSpeech([], { synthesizer: null }));
    expect(result.current.isSupported).toBe(false);
    expect(result.current.enabled).toBe(false);
  });

  it("does not speak pre-existing history when toggled on", () => {
    const fake = new FakeSpeechSynthesizer();
    const messages: AgentMessage[] = [agentMsg("a1", "hello")];
    const { result } = renderHook(() => useTextToSpeech(messages, { synthesizer: fake }));

    act(() => result.current.toggle());

    expect(result.current.enabled).toBe(true);
    expect(fake.spoken).toEqual([]);
  });

  it("speaks a newly appended agent message once enabled", () => {
    const fake = new FakeSpeechSynthesizer();
    let messages: AgentMessage[] = [];
    const { result, rerender } = renderHook(({ msgs }) => useTextToSpeech(msgs, { synthesizer: fake }), {
      initialProps: { msgs: messages },
    });

    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);

    messages = [...messages, agentMsg("a1", "your total balance is $500")];
    rerender({ msgs: messages });

    expect(fake.spoken).toEqual(["your total balance is $500"]);
  });

  it("does not double-speak on an unrelated re-render with the same messages array", () => {
    const fake = new FakeSpeechSynthesizer();
    let messages: AgentMessage[] = [agentMsg("a1", "hello")];
    const { result, rerender } = renderHook(({ msgs }) => useTextToSpeech(msgs, { synthesizer: fake }), {
      initialProps: { msgs: messages },
    });
    act(() => result.current.toggle());

    messages = [...messages, agentMsg("a2", "new message")];
    rerender({ msgs: messages });
    expect(fake.spoken).toEqual(["new message"]);

    // Re-render with the identical array — nothing new to speak.
    rerender({ msgs: messages });
    expect(fake.spoken).toEqual(["new message"]);
  });

  it("ignores user messages — only agent replies are spoken", () => {
    const fake = new FakeSpeechSynthesizer();
    let messages: AgentMessage[] = [];
    const { result, rerender } = renderHook(({ msgs }) => useTextToSpeech(msgs, { synthesizer: fake }), {
      initialProps: { msgs: messages },
    });
    act(() => result.current.toggle());

    messages = [...messages, userMsg("u1", "show my accounts")];
    rerender({ msgs: messages });

    expect(fake.spoken).toEqual([]);
  });

  it("cancels and speaks only the latest message when several arrive in one update", () => {
    const fake = new FakeSpeechSynthesizer();
    let messages: AgentMessage[] = [];
    const { result, rerender } = renderHook(({ msgs }) => useTextToSpeech(msgs, { synthesizer: fake }), {
      initialProps: { msgs: messages },
    });
    act(() => result.current.toggle());

    messages = [...messages, agentMsg("a1", "first"), agentMsg("a2", "second")];
    rerender({ msgs: messages });

    expect(fake.cancelCalls).toBe(1);
    expect(fake.spoken).toEqual(["second"]);

    // Neither message is ever spoken again on a later update.
    messages = [...messages, agentMsg("a3", "third")];
    rerender({ msgs: messages });
    expect(fake.spoken).toEqual(["second", "third"]);
  });

  it("cancels in-flight speech immediately when toggled off", () => {
    const fake = new FakeSpeechSynthesizer();
    const { result } = renderHook(() => useTextToSpeech([], { synthesizer: fake }));

    act(() => result.current.toggle()); // on
    act(() => result.current.toggle()); // off

    expect(fake.cancelCalls).toBe(1);
    expect(result.current.enabled).toBe(false);
  });
});
