import { useCallback, useState } from "react";
import { StoreProvider } from "./mock-data/store";
import { Nav, type Screen } from "./app/Nav";
import { AccountsScreen } from "./app/AccountsScreen";
import { TransactionsScreen } from "./app/TransactionsScreen";
import { TransferForm } from "./app/TransferForm";
import { PayPayeeForm } from "./app/PayPayeeForm";
import { AgentOverlay, type AgentOverlayHandle } from "./agent-overlay/AgentOverlay";
import { useAgentSession } from "./agent-overlay/useAgentSession";
import { GuidedTour } from "./tour/GuidedTour";
import { TourNudge } from "./tour/TourNudge";
import { useTourNudge } from "./tour/useTourNudge";
import { ArchitectureShowcase } from "./architecture-showcase/ArchitectureShowcase";

export function App() {
  const [screen, setScreen] = useState<Screen>("accounts");
  const [tourActive, setTourActive] = useState(false);
  const [showcaseActive, setShowcaseActive] = useState(false);
  const [agentHandle, setAgentHandle] = useState<AgentOverlayHandle | null>(null);
  const { showNudge, dismissNudge } = useTourNudge();

  // Owned here, not inside AgentOverlay, so the showcase page (opened
  // alongside the normal app) observes the SAME live model/session/message
  // history as the chat panel — one on-device model instance, one real
  // pipeline, two views onto it.
  const session = useAgentSession({ onNavigate: setScreen });

  const registerAgentHandle = useCallback((handle: AgentOverlayHandle) => {
    setAgentHandle(handle);
  }, []);

  function startTour() {
    dismissNudge();
    setTourActive(true);
  }

  return (
    <StoreProvider>
      <div className="shell">
        <div className="main-column">
          <div className="topbar">
            <div className="brand">
              <div className="brand-mark">MB</div>
              <div>
                <div className="brand-name">Mock Bank</div>
                <div className="brand-tag">Agent demo</div>
              </div>
            </div>
            <div className="topbar-actions">
              <button className="tour-button" onClick={startTour}>
                <span className="sparkle">✦</span> Guided tour
              </button>
              <button className="tour-button showcase-button" onClick={() => setShowcaseActive(true)}>
                <span className="sparkle">◈</span> Live architecture
              </button>
            </div>
          </div>

          <Nav current={screen} onChange={setScreen} />
          {screen === "accounts" && <AccountsScreen />}
          {screen === "transactions" && <TransactionsScreen />}
          {screen === "transfer" && <TransferForm />}
          {screen === "pay" && <PayPayeeForm />}
        </div>

        <AgentOverlay registerHandle={registerAgentHandle} session={session} />
      </div>

      {tourActive && (
        <GuidedTour onScreenChange={setScreen} agentHandle={agentHandle} onClose={() => setTourActive(false)} />
      )}

      {!tourActive && showNudge && <TourNudge onStart={startTour} onDismiss={dismissNudge} />}

      {showcaseActive && <ArchitectureShowcase session={session} onClose={() => setShowcaseActive(false)} />}
    </StoreProvider>
  );
}
