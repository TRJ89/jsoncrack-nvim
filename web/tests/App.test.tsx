import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../src/types";
import { App } from "../src/App";

const graphControl = vi.hoisted(() => ({ failureJson: null as string | null }));

vi.mock("../src/GraphView", async () => {
  const React = await import("react");
  function nodeCount(value: unknown): number {
    if (Array.isArray(value)) return 1 + value.reduce((count, item) => count + nodeCount(item), 0);
    if (value && typeof value === "object") {
      return 1 + Object.values(value).reduce((count, item) => count + nodeCount(item), 0);
    }
    return 1;
  }
  return {
    GraphView: (props: {
      json: string;
      onRendered?: () => void;
      onRenderError?: (message: string) => void;
    }) => {
      const tooLarge = nodeCount(JSON.parse(props.json)) > 1500;
      React.useEffect(() => {
        if (graphControl.failureJson === props.json) {
          props.onRenderError?.("Simulated renderer failure");
        } else if (!tooLarge) {
          props.onRendered?.();
        }
      }, [props.json]);
      const message =
        graphControl.failureJson === props.json
          ? React.createElement("div", { role: "alert" }, "Unable to render JSON graph: Simulated renderer failure")
          : tooLarge
            ? React.createElement("div", { role: "status" }, "Too large to render: 1501 nodes; limit is 1500.")
            : null;
      return React.createElement(
        "div",
        { "data-testid": "graph", "data-json": props.json },
        message,
      );
    },
  };
});

function okSnapshot(revision: string, text: string, display_name = "fixture.json"): Snapshot {
  return {
    protocol: 1,
    revision,
    format: "json",
    display_name,
    status: "ok",
    text,
  };
}

function inputError(revision: string, message = "The target file is unavailable."): Snapshot {
  return {
    protocol: 1,
    revision,
    format: "json",
    display_name: "fixture.json",
    status: "error",
    error: { code: "FILE_UNAVAILABLE", message },
  };
}

function jsonResponse(snapshot: Snapshot, etag: string): Response {
  return new Response(JSON.stringify(snapshot), { status: 200, headers: { ETag: etag } });
}

function installFetch(...responses: Response[]) {
  const request = vi.fn<typeof fetch>();
  for (const response of responses) request.mockResolvedValueOnce(response);
  request.mockResolvedValue(new Response(null, { status: 304 }));
  vi.stubGlobal("fetch", request);
  return request;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function nextPoll(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  await flush();
}

describe("App", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T01:00:00.000Z"));
    graphControl.failureJson = null;
    window.history.replaceState({}, "", "/#token=" + "a".repeat(64));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not replace the last valid graph with invalid input", async () => {
    const fetchMock = installFetch(
      jsonResponse(okSnapshot("revision-a", '{"a":1}'), '"revision-a"'),
      jsonResponse(okSnapshot("revision-b", "{"), '"revision-b"'),
      jsonResponse(okSnapshot("revision-a", '{"a":1}'), '"revision-a"'),
    );
    render(<App />);
    await flush();
    const displayedAt = screen.getByTestId("last-rendered").getAttribute("datetime");
    expect(screen.getByTestId("graph")).toHaveAttribute("data-json", '{"a":1}');

    await nextPoll();
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByTestId("graph")).toHaveAttribute("data-json", '{"a":1}');
    expect(screen.getByText("Showing the last valid graph")).toBeVisible();

    await nextPoll();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Showing the last valid graph")).not.toBeInTheDocument();
    expect(screen.getByTestId("graph")).toHaveAttribute("data-json", '{"a":1}');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("If-None-Match")).toBe('"revision-b"');
    expect(screen.getByTestId("last-rendered").getAttribute("datetime")).toBe(displayedAt);
  });

  it("shows an initial invalid input without mounting a graph", async () => {
    installFetch(jsonResponse(okSnapshot("invalid", "{"), '"invalid"'));
    render(<App />);
    await flush();

    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByTestId("graph")).not.toBeInTheDocument();
    expect(screen.getByText("fixture.json", { exact: true })).toBeVisible();
  });

  it("distinguishes read errors and keeps filenames as text", async () => {
    installFetch(
      jsonResponse(
        okSnapshot("valid", '"<script>alert(1)</script>"', "<img src=x onerror=alert(1)>"),
        '"valid"',
      ),
      jsonResponse(inputError("read-error"), '"read-error"'),
    );
    const { container } = render(<App />);
    await flush();
    expect(screen.getByText("<img src=x onerror=alert(1)>", { exact: true })).toBeVisible();
    expect(container.querySelector("img, script")).toBeNull();

    await nextPoll();
    expect(screen.getByRole("alert")).toHaveTextContent("The target file is unavailable.");
    expect(screen.getByTestId("graph")).toHaveAttribute(
      "data-json",
      '"<script>alert(1)</script>"',
    );
    expect(screen.getByText("Showing the last valid graph")).toBeVisible();
  });

  it("shows renderer failures without recording a successful display time", async () => {
    const json = '{"broken":true}';
    graphControl.failureJson = json;
    installFetch(jsonResponse(okSnapshot("render-fail", json), '"render-fail"'));
    render(<App />);
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent("Simulated renderer failure");
    expect(screen.getByTestId("last-rendered")).toHaveTextContent("Not rendered yet");
  });

  it("shows the graph node limit as a distinct graph status", async () => {
    const manyNodes = JSON.stringify(Array.from({ length: 1501 }, (_, index) => index));
    installFetch(jsonResponse(okSnapshot("too-many", manyNodes), '"too-many"'));
    render(<App />);
    await flush();

    expect(screen.getByRole("status")).toHaveTextContent("Too large to render");
    expect(screen.getByTestId("last-rendered")).toHaveTextContent("Not rendered yet");
  });

  it("displays a stopped connection and can reconnect to the same origin", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse(okSnapshot("again", '{"ok":true}'), '"again"'));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await flush();

    expect(screen.getByText("Preview connection stopped")).toBeVisible();
    await act(async () => {
      screen.getByRole("button", { name: "Reconnect" }).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(fetchMock.mock.calls[0]?.[0]);
    await flush();
    expect(screen.queryByText("Preview connection stopped")).not.toBeInTheDocument();
    expect(screen.getByTestId("graph")).toHaveAttribute("data-json", '{"ok":true}');
  });
});
