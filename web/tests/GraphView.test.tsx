import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphView } from "../src/GraphView";

const rendererState = vi.hoisted(() => ({
  instanceCount: 0,
  renderedNodeId: "old",
  renderedText: "old",
  opacity: "1",
}));

vi.mock("jsoncrack-react", async () => {
  const React = await import("react");
  return {
    JSONCrack: (props: {
      json: string;
      onParse?: (graph: { nodes: Array<{ id: string }>; edges: [] }) => void;
    }) => {
      if (JSON.parse(props.json) === "throw") throw new Error("Simulated renderer failure");
      const [instanceId] = React.useState(() => ++rendererState.instanceCount);
      React.useEffect(() => {
        props.onParse?.({
          nodes: [{ id: String(JSON.parse(props.json)) }],
          edges: [],
        });
      }, [props.json, props.onParse]);
      return React.createElement(
        "div",
        {
          "data-testid": "renderer",
          "data-instance-id": instanceId,
          "data-json": props.json,
        },
        React.createElement(
          "div",
          {
            className: "jsoncrack-space",
            style: { opacity: rendererState.opacity, visibility: "visible" },
          },
          React.createElement(
            "svg",
            null,
            React.createElement("g", null),
            React.createElement("foreignObject", {
              "data-id": `node-${rendererState.renderedNodeId}`,
              "data-key": rendererState.renderedText,
            }),
          ),
        ),
      );
    },
  };
});

function animationFrame(callback: FrameRequestCallback): number {
  return window.setTimeout(() => callback(performance.now()), 16);
}

describe("GraphView renderer lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rendererState.instanceCount = 0;
    rendererState.renderedNodeId = "old";
    rendererState.renderedText = "old";
    rendererState.opacity = "1";
    vi.stubGlobal("requestAnimationFrame", animationFrame);
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for the current graph nodes and visible layout before reporting completion", async () => {
    const onRendered = vi.fn();
    const view = render(<GraphView json={'"old"'} onRendered={onRendered} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(onRendered).toHaveBeenCalledTimes(1);

    rendererState.opacity = "0";
    view.rerender(<GraphView json={'"new"'} onRendered={onRendered} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160);
    });
    expect(onRendered).toHaveBeenCalledTimes(1);

    rendererState.renderedNodeId = "new";
    rendererState.renderedText = "new";
    rendererState.opacity = "1";
    view.rerender(<GraphView json={'"new"'} onRendered={onRendered} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(onRendered).toHaveBeenCalledTimes(2);
  });

  it("resets its error boundary for a new input after a renderer exception", () => {
    const onRenderError = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(
      <GraphView json={'"old"'} onRenderError={onRenderError} />,
    );
    const previousInstanceId = screen.getByTestId("renderer").getAttribute("data-instance-id");

    view.rerender(<GraphView json={'"throw"'} onRenderError={onRenderError} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Simulated renderer failure");
    expect(onRenderError).toHaveBeenCalledWith("Simulated renderer failure");

    view.rerender(<GraphView json={'"recovered"'} onRenderError={onRenderError} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("renderer")).toHaveAttribute("data-json", '"recovered"');
    expect(screen.getByTestId("renderer").getAttribute("data-instance-id")).not.toBe(
      previousInstanceId,
    );
    consoleError.mockRestore();
  });
});
