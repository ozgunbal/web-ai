import { useEffect, useRef } from "react";
import type { useAgentSession } from "./useAgentSession";
import { ChatInput } from "./ChatInput";
import { IntentPreview } from "./IntentPreview";
import { ConfirmDialog } from "./ConfirmDialog";
import { ModelLoadPanel } from "./ModelLoadPanel";
import { useTextToSpeech } from "./useTextToSpeech";

const SUGGESTIONS = [
  "show me my accounts",
  "transfer $200 from checking to savings",
  "pay Jane Smith $75",
];

export interface AgentOverlayHandle {
  send: (text: string) => void;
}

/**
 * Session is owned by the caller (App.tsx) and passed in, rather than created
 * here, so the architecture showcase page (see ArchitectureShowcase.tsx) can
 * observe the SAME live session — same messages, same model instance — as
 * this chat panel, instead of spinning up a second on-device model and a
 * disconnected message history.
 */
export function AgentOverlay({
  registerHandle,
  session,
}: {
  registerHandle?: (handle: AgentOverlayHandle) => void;
  session: ReturnType<typeof useAgentSession>;
}) {
  const { messages, send, confirm, cancel, retryModelLoad, modelStatus, loadProgress } = session;
  const scrollRef = useRef<HTMLDivElement>(null);
  const isReady = modelStatus === "ready";
  // Scoped to this panel only — see useTextToSpeech's docstring for why it
  // isn't also mounted in ArchitectureShowcase despite sharing `messages`.
  const tts = useTextToSpeech(messages);

  useEffect(() => {
    registerHandle?.({ send });
  }, [registerHandle, send]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const statusLabel =
    modelStatus === "idle"
      ? "idle"
      : modelStatus === "loading"
        ? "downloading model…"
        : modelStatus === "ready"
          ? "ready"
          : "error";

  return (
    <aside className="agent-panel" data-testid="agent-overlay" data-tour="agent-panel">
      <div className="agent-header">
        <div className="agent-header-title">
          <span className="agent-avatar">🤖</span>
          Agent
        </div>
        <div className="agent-header-actions">
          <span className="model-status-pill" data-testid="model-status">
            <span className={`status-dot ${modelStatus}`} />
            {statusLabel}
          </span>
          {tts.isSupported ? (
            <button
              className={`tts-toggle-btn${tts.enabled ? " on" : ""}`}
              onClick={tts.toggle}
              aria-pressed={tts.enabled}
              aria-label={tts.enabled ? "Disable spoken replies" : "Enable spoken replies"}
              title="Read agent replies aloud"
              data-testid="agent-tts-toggle"
            >
              {tts.enabled ? "🔊" : "🔈"}
            </button>
          ) : null}
        </div>
      </div>

      {!isReady ? <ModelLoadPanel status={modelStatus} progress={loadProgress} onRetry={retryModelLoad} /> : null}

      <div className="agent-messages" ref={scrollRef} data-testid="agent-messages">
        {messages.length === 0 && isReady ? (
          <div className="agent-empty-state">
            <span className="icon">💬</span>
            <div>
              Ask the agent to look something up or move money. It will always show you what it
              understood and why before doing anything risky.
            </div>
            <div className="suggestion-list">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`msg-row ${m.role}`} data-role={m.role}>
              <div className={`msg-bubble${m.rejected ? " rejected" : ""}`}>
                {m.text}
                {m.role === "agent" && m.elapsedMs !== undefined ? (
                  <span className="elapsed-badge" title="Time to respond">
                    {(m.elapsedMs / 1000).toFixed(1)}s
                  </span>
                ) : null}
                <IntentPreview message={m} />
                <ConfirmDialog message={m} onConfirm={confirm} onCancel={cancel} />
                {m.canRetryModelLoad ? (
                  <button className="retry-btn" onClick={() => retryModelLoad()}>
                    ↻ Clear cache &amp; retry
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="agent-input-area">
        <ChatInput onSend={send} disabled={!isReady} />
        {!isReady ? (
          <div className="input-disabled-hint">
            {modelStatus === "error" ? "Model failed to load — retry above to enable chat." : "Waiting for the on-device model to finish loading…"}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
