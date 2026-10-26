import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verifies the real-world gap hit live: asking the agent to do something
 * while on a different screen produced "Approved but could not execute: No
 * [data-agent-action=...] element found on current screen" — even though the
 * intent was parsed and approved correctly. App.tsx only mounts ONE screen's
 * DOM at a time, so the agent must navigate to the intent's owning screen
 * BEFORE executeIntent() looks for its [data-agent-action] container.
 *
 * Mocks @web-ai-trials/core/web so this test exercises the real navigation
 * logic (ensureCorrectScreen in useAgentSession.ts) without needing a real
 * WebGPU/WebLLM engine.
 */
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

import { useAgentSession } from "./useAgentSession";
import { parseIntent } from "@web-ai-trials/core/web";

function setDom(html: string) {
  document.body.innerHTML = html;
}

describe("useAgentSession — auto-navigation before execution", () => {
  beforeEach(() => {
    vi.mocked(parseIntent).mockReset();
  });

  afterEach(() => {
    setDom("");
  });

  it("navigates to the accounts screen before executing a list_accounts intent, when currently elsewhere", async () => {
    vi.mocked(parseIntent).mockResolvedValue({
      ok: true,
      intent: { type: "list_accounts", rawInputSummary: "show accounts" },
      retriesUsed: 0,
      rawOutputs: [],
    });

    // Simulate starting on the transfer screen: no [data-agent-action="list_accounts"]
    // container exists yet — only appears once onNavigate switches to "accounts".
    setDom(`<form data-agent-action="transfer_internal"></form>`);

    const navigatedTo: string[] = [];
    const onNavigate = (screen: string) => {
      navigatedTo.push(screen);
      // Simulate React re-rendering the new screen, the way App.tsx's
      // conditional rendering actually would.
      if (screen === "accounts") {
        setDom(`<section data-agent-action="list_accounts"></section>`);
      }
    };

    const { result } = renderHook(() => useAgentSession({ onNavigate }));

    await waitFor(() => expect(result.current.modelStatus).toBe("ready"));

    await act(async () => {
      await result.current.send("show me my accounts");
    });

    await waitFor(() => {
      const lastMessage = result.current.messages[result.current.messages.length - 1];
      expect(lastMessage?.text).toContain("Done");
    });

    expect(navigatedTo).toContain("accounts");
  });

  it("reports a 'logged for a future iteration' message and records an audit-log entry for schedule_recurring_payment, which has no screen at all, once confirmed", async () => {
    // schedule_recurring_payment's policy decision is "confirm" (see
    // policy.config.ts), so the no-screen check only fires once the user
    // clicks Confirm on the resulting confirm-card, not on the initial send.
    vi.mocked(parseIntent).mockResolvedValue({
      ok: true,
      intent: {
        type: "schedule_recurring_payment",
        rawInputSummary: "monthly payment",
        payeeId: "p1",
        amount: 30,
        currency: "USD",
        frequency: "monthly",
        startDate: "2026-09-01",
      },
      retriesUsed: 0,
      rawOutputs: [],
    });

    const { result } = renderHook(() => useAgentSession());
    await waitFor(() => expect(result.current.modelStatus).toBe("ready"));

    await act(async () => {
      await result.current.send("set up a monthly payment");
    });

    const pendingMessage = result.current.messages.find((m) => m.pendingConfirm);
    expect(pendingMessage).toBeDefined();

    const entriesBefore = result.current.auditLog.all().length;

    await act(async () => {
      await result.current.confirm(pendingMessage!);
    });

    await waitFor(() => {
      const lastMessage = result.current.messages[result.current.messages.length - 1];
      // Generic across any current/future null-mapped intent type — names
      // the intent type directly, not hardcoded wording for this one action.
      expect(lastMessage?.text).toMatch(/isn't available in this demo yet/i);
      expect(lastMessage?.text).toContain("schedule_recurring_payment");
      expect(lastMessage?.text).toMatch(/logged it/i);
    });

    // A real, timestamped record now exists of what was asked for but isn't
    // supported yet — not just a friendlier one-line chat message.
    const entriesAfter = result.current.auditLog.all();
    expect(entriesAfter.length).toBe(entriesBefore + 1);
    const loggedEntry = entriesAfter[entriesAfter.length - 1]!;
    expect(loggedEntry.rejectionReason).toContain("schedule_recurring_payment");
  });

  it("attaches a non-negative elapsedMs to every agent reply, and none to the user's own message", async () => {
    vi.mocked(parseIntent).mockResolvedValue({
      ok: true,
      intent: { type: "list_accounts", rawInputSummary: "show accounts" },
      retriesUsed: 0,
      rawOutputs: [],
    });
    setDom(`<section data-agent-action="list_accounts"></section>`);

    const { result } = renderHook(() => useAgentSession());
    await waitFor(() => expect(result.current.modelStatus).toBe("ready"));

    await act(async () => {
      await result.current.send("show me my accounts");
    });

    await waitFor(() => {
      const lastMessage = result.current.messages[result.current.messages.length - 1];
      expect(lastMessage?.text).toContain("Done");
    });

    const userMessage = result.current.messages.find((m) => m.role === "user");
    const agentMessage = result.current.messages.find((m) => m.role === "agent");
    expect(userMessage?.elapsedMs).toBeUndefined();
    expect(agentMessage?.elapsedMs).toBeTypeOf("number");
    expect(agentMessage?.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
