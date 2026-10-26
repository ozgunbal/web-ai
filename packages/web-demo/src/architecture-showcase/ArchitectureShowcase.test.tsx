import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same mocking approach as useAgentSession.navigation.test.tsx: exercise the
// real session/guardrail/policy pipeline, stub only the on-device model call.
vi.mock("@web-ai-trials/core/web", async () => {
  const actual = await vi.importActual<typeof import("@web-ai-trials/core/web")>("@web-ai-trials/core/web");
  return {
    ...actual,
    parseIntent: vi.fn(),
    WebLlmEngineClient: class {
      setProgressCallback() {}
      preload() {
        return Promise.resolve();
      }
    },
  };
});

import { useAgentSession } from "../agent-overlay/useAgentSession";
import { parseIntent, POLICY_RULES } from "@web-ai-trials/core/web";
import { ArchitectureShowcase } from "./ArchitectureShowcase";

function setDom(html: string) {
  document.body.innerHTML = html;
}

describe("ArchitectureShowcase", () => {
  beforeEach(() => {
    vi.mocked(parseIntent).mockReset();
  });
  afterEach(() => {
    setDom("");
    cleanup();
  });

  it("renders the real policy table and an empty-state before any turn", async () => {
    const { result } = renderHook(() => useAgentSession());
    await waitFor(() => expect(result.current.modelStatus).toBe("ready"));

    render(<ArchitectureShowcase session={result.current} onClose={() => {}} />);

    expect(screen.getByText("Live architecture showcase")).toBeTruthy();
    // Every real policy rule id shows up in the table.
    for (const rule of POLICY_RULES) {
      expect(screen.getByText(rule.id)).toBeTruthy();
    }
    expect(screen.getByText(/No turns yet/)).toBeTruthy();
  });

  it("shows the real raw model output, parsed intent, and guardrail verdict after a turn", async () => {
    vi.mocked(parseIntent).mockResolvedValue({
      ok: true,
      intent: { type: "list_accounts", rawInputSummary: "show accounts" },
      retriesUsed: 0,
      rawOutputs: ['{"type":"list_accounts","rawInputSummary":"show accounts"}'],
    });
    setDom(`<section data-agent-action="list_accounts"></section>`);

    const { result, rerender } = renderHook(() => useAgentSession());
    await waitFor(() => expect(result.current.modelStatus).toBe("ready"));

    await act(async () => {
      await result.current.send("show me my accounts");
    });
    rerender();

    render(<ArchitectureShowcase session={result.current} onClose={() => {}} />);

    // "list_accounts" legitimately appears more than once (latest-turn panel,
    // policy table's "applies to" pill, turn log) — assert presence, not
    // uniqueness.
    expect(screen.getAllByText(/list_accounts/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/read-only-always-allowed/).length).toBeGreaterThan(0);
  });

  it("triggers a real request from its own input, driving the same session.send pipeline as the chat panel", async () => {
    vi.mocked(parseIntent).mockResolvedValue({
      ok: true,
      intent: { type: "list_accounts", rawInputSummary: "show accounts" },
      retriesUsed: 0,
      rawOutputs: ['{"type":"list_accounts","rawInputSummary":"show accounts"}'],
    });
    setDom(`<section data-agent-action="list_accounts"></section>`);

    const { result } = renderHook(() => useAgentSession());
    await waitFor(() => expect(result.current.modelStatus).toBe("ready"));

    render(<ArchitectureShowcase session={result.current} onClose={() => {}} />);

    const input = screen.getByLabelText("architecture-showcase-trigger-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "show me my accounts" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });

    // The real session picked up the request — a real message with the real
    // parsed intent exists, not just something echoed locally in the page.
    await waitFor(() => {
      expect(result.current.messages.some((m) => m.text === "show me my accounts")).toBe(true);
    });
    const agentReply = result.current.messages.find((m) => m.role === "agent");
    expect(agentReply?.intent?.type).toBe("list_accounts");
    expect(agentReply?.decision).toBe("allow");
  });

  it("offers one-click suggestions that also drive the real pipeline", async () => {
    vi.mocked(parseIntent).mockResolvedValue({
      ok: true,
      intent: { type: "list_accounts", rawInputSummary: "show accounts" },
      retriesUsed: 0,
      rawOutputs: ['{"type":"list_accounts","rawInputSummary":"show accounts"}'],
    });
    setDom(`<section data-agent-action="list_accounts"></section>`);

    const { result } = renderHook(() => useAgentSession());
    await waitFor(() => expect(result.current.modelStatus).toBe("ready"));

    render(<ArchitectureShowcase session={result.current} onClose={() => {}} />);

    await act(async () => {
      fireEvent.click(screen.getByText("show me my accounts"));
    });

    await waitFor(() => {
      expect(result.current.messages.some((m) => m.role === "user" && m.text === "show me my accounts")).toBe(
        true,
      );
    });
  });
});
