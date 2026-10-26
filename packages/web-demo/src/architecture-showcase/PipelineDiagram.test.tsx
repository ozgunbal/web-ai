import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineDiagram } from "./PipelineDiagram";

describe("PipelineDiagram", () => {
  it("renders all five real pipeline stages", () => {
    render(<PipelineDiagram activeStage="parse" />);
    expect(screen.getByText("On-device LLM")).toBeTruthy();
    expect(screen.getByText("User message")).toBeTruthy();
    expect(screen.getByText("Intent parser")).toBeTruthy();
    expect(screen.getByText("Guardrail")).toBeTruthy();
    expect(screen.getByText("DOM adapter")).toBeTruthy();
  });

  it("marks only the active stage", () => {
    const { container } = render(<PipelineDiagram activeStage="guardrail" />);
    const activeStages = container.querySelectorAll(".pipeline-stage.active");
    expect(activeStages).toHaveLength(1);
    expect(activeStages[0]?.textContent).toContain("Guardrail");
  });
});
