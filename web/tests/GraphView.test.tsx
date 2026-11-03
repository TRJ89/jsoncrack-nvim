import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphView } from "../src/GraphView";

const rendererState = vi.hoisted(() => ({
  instanceCount: 0,
  renderedNodeId: "old",
  renderedText: "old",
  opacity: "1",
  useActualGraph: false,
}));

vi.mock("jsoncrack-react", async () => {
  const React = await import("react");
  const actual = await vi.importActual<typeof import("jsoncrack-react")>("jsoncrack-react");
  return {
    JSONCrack: (props: {
      json: string;
      onParse?: (graph: import("jsoncrack-react").GraphData) => void;
      onNodeClick?: (node: import("jsoncrack-react").NodeData) => void;
    }) => {
      if (JSON.parse(props.json) === "throw") throw new Error("Simulated renderer failure");
      const [instanceId] = React.useState(() => ++rendererState.instanceCount);
      const actualGraph = actual.parseGraph(props.json);
      const graph = rendererState.useActualGraph
        ? actualGraph
        : {
            nodes: [{ id: String(JSON.parse(props.json)) }] as import("jsoncrack-react").NodeData[],
            edges: [],
          };
      const clickNode = actualGraph.nodes.find((node) =>
        JSON.stringify(node.path) === JSON.stringify(["target"]),
      ) ?? actualGraph.nodes[0];
      React.useEffect(() => {
        props.onParse?.(graph);
      }, [props.json, props.onParse]);
      return React.createElement(
        "div",
        {
          "data-testid": "renderer",
          "data-instance-id": instanceId,
          "data-json": props.json,
        },
        React.createElement("button", {
          type: "button",
          "data-testid": "click-node",
          onClick: () => clickNode && props.onNodeClick?.(clickNode),
        }, "Select node"),
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
            ...(rendererState.useActualGraph
              ? graph.nodes.map((node) => React.createElement("foreignObject", {
                  key: node.id,
                  "data-id": `node-${node.id}`,
                  "data-key": node.id,
                }))
              : [React.createElement("foreignObject", {
                  "data-id": `node-${rendererState.renderedNodeId}`,
                  "data-key": rendererState.renderedText,
                })]),
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
    rendererState.useActualGraph = false;
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

  it("opens node-local details from the renderer callback and closes on valid replacement", () => {
    rendererState.useActualGraph = true;
    const view = render(<GraphView json='{"target":{"value":"visible"}}' />);
    const opener = screen.getByTestId("click-node");
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("$.target")).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("pre")?.textContent).toBe(
      '{\n  "value": "visible"\n}',
    );

    view.rerender(<GraphView json='{"target":{"value":"updated"}}' />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("graph")).toHaveFocus();
  });

  it("opens details for an empty root container from the fallback action", () => {
    render(<GraphView json="{}" />);

    fireEvent.click(screen.getByRole("button", { name: "View details" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("$")).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("pre")?.textContent).toBe("{}");
  });
});
