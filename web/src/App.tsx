import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { GraphView } from "./GraphView";
import { parseSource } from "./parse";
import { createPoller, type PollEvent } from "./poll";
import type { Format, ParseError, Snapshot } from "./types";

type ConnectionState = "connecting" | "connected" | "retrying" | "stopped";
type Connection = { state: ConnectionState; message: string | null };
type FileInfo = { displayName: string; format: Format } | null;
type InputProblem = { kind: "read" | "parse"; message: string } | null;

function tokenFromFragment(): string | null {
  const fragment = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const token = new URLSearchParams(fragment).get("token");
  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
}

function parseMessage(error: ParseError): string {
  const location =
    error.line !== undefined && error.column !== undefined
      ? " (line " + error.line + ", column " + error.column + ")"
      : "";
  return error.message + location;
}

function connectionLabel(connection: Connection): string {
  switch (connection.state) {
    case "connecting":
      return "Connecting to preview…";
    case "connected":
      return "Connected";
    case "retrying":
      return "Reconnecting to preview…";
    case "stopped":
      return "Preview connection stopped";
  }
}

export function App(): ReactElement {
  const [token] = useState(tokenFromFragment);
  const [connection, setConnection] = useState<Connection>({
    state: token ? "connecting" : "stopped",
    message: token ? null : "The preview token is missing or invalid. Reopen the preview from Neovim.",
  });
  const [fileInfo, setFileInfo] = useState<FileInfo>(null);
  const [inputProblem, setInputProblem] = useState<InputProblem>(null);
  const [renderProblem, setRenderProblem] = useState<string | null>(null);
  const [graphJson, setGraphJson] = useState<string | null>(null);
  const [lastRenderedAt, setLastRenderedAt] = useState<string | null>(null);
  const graphJsonRef = useRef<string | null>(null);
  const latestRevisionRef = useRef<string | null>(null);
  const lastGoodRef = useRef<{ revision: string; json: string } | null>(null);
  const eventHandlerRef = useRef<(event: PollEvent) => void>(() => undefined);
  const pollerRef = useRef<ReturnType<typeof createPoller> | null>(null);

  const handleSnapshot = useCallback((snapshot: Snapshot): void => {
    if (latestRevisionRef.current === snapshot.revision) return;
    latestRevisionRef.current = snapshot.revision;
    setFileInfo({ displayName: snapshot.display_name, format: snapshot.format });

    if (snapshot.status === "error") {
      setInputProblem({ kind: "read", message: snapshot.error.message });
      return;
    }

    const previousGood = lastGoodRef.current;
    if (previousGood?.revision === snapshot.revision) {
      setInputProblem(null);
      return;
    }

    let result: ReturnType<typeof parseSource>;
    try {
      result = parseSource(snapshot.text, snapshot.format);
    } catch {
      setInputProblem({ kind: "parse", message: "The input could not be processed." });
      return;
    }

    if (!result.ok) {
      setInputProblem({ kind: "parse", message: parseMessage(result.error) });
      return;
    }

    lastGoodRef.current = { revision: snapshot.revision, json: result.json };
    setInputProblem(null);
    if (graphJsonRef.current !== result.json) {
      graphJsonRef.current = result.json;
      setGraphJson(result.json);
      setRenderProblem(null);
    }
  }, []);

  eventHandlerRef.current = (event: PollEvent): void => {
    if (event.kind === "connection") {
      setConnection({
        state: event.state,
        message: event.message ?? null,
      });
      return;
    }
    handleSnapshot(event.value);
  };

  const handleRendered = useCallback((json: string): void => {
    if (graphJsonRef.current !== json) return;
    setLastRenderedAt(new Date().toISOString());
    setRenderProblem(null);
  }, []);

  const handleRenderError = useCallback((json: string, message: string): void => {
    if (graphJsonRef.current !== json) return;
    setRenderProblem(message || "The graph could not be rendered.");
  }, []);

  const reconnect = useCallback((): void => {
    pollerRef.current?.reconnect();
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    const poller = createPoller({
      token,
      onEvent: (event) => eventHandlerRef.current(event),
    });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [token]);

  const showingLastValidGraph =
    graphJson !== null &&
    (inputProblem !== null || connection.state === "retrying" || connection.state === "stopped");
  const statusText = renderProblem ? "Graph rendering failed" : inputProblem ? "Input error" : connectionLabel(connection);

  return (
    <main className="preview-app">
      <header className="preview-header">
        <div className="file-heading">
          <h1>{fileInfo?.displayName ?? "JSON Crack Preview"}</h1>
          {fileInfo && <span className="format-badge">{fileInfo.format.toUpperCase()}</span>}
        </div>
        <div className="preview-meta">
          <p className="connection-state" data-testid="connection-state">
            {statusText}
          </p>
          {fileInfo && (
            <p className="saved-state">
              {fileInfo.format === "json" ? "JSON" : "YAML"} preview · saved file
            </p>
          )}
          <p className="last-rendered-label">
            Last displayed{" "}
            {lastRenderedAt ? (
              <time data-testid="last-rendered" dateTime={lastRenderedAt}>
                {new Date(lastRenderedAt).toLocaleTimeString()}
              </time>
            ) : (
              <span data-testid="last-rendered">Not rendered yet</span>
            )}
          </p>
          {connection.state === "stopped" && token && (
            <button className="reconnect-button" type="button" onClick={reconnect}>
              Reconnect
            </button>
          )}
        </div>
      </header>

      {inputProblem && (
        <div className="error-banner" role="alert">
          {inputProblem.kind === "read" ? "File read error: " : "Input error: "}
          {inputProblem.message}
          {showingLastValidGraph && (
            <span className="stale-label"> Showing the last valid graph</span>
          )}
        </div>
      )}
      {connection.state === "retrying" && (
        <div className="connection-banner" aria-live="polite">
          {connection.message ?? "Connection to the local preview failed."}
          {showingLastValidGraph && (
            <span className="stale-label"> Showing the last valid graph</span>
          )}
        </div>
      )}
      {connection.state === "stopped" && (
        <div className="error-banner" role="alert">
          {connection.message ?? "Preview connection stopped."}
          {showingLastValidGraph && (
            <span className="stale-label"> Showing the last valid graph</span>
          )}
        </div>
      )}
      {renderProblem && (
        <div className="render-banner" aria-live="polite">
          Graph rendering failed: {renderProblem}
        </div>
      )}

      <section className="graph-region" aria-label="JSON graph preview">
        {graphJson === null ? (
          <div className="empty-preview" role="status">
            {inputProblem ? "Waiting for valid input." : "Waiting for the first saved snapshot."}
          </div>
        ) : (
          <GraphView
            json={graphJson}
            onRendered={() => handleRendered(graphJson)}
            onRenderError={(message) => handleRenderError(graphJson, message)}
          />
        )}
      </section>
    </main>
  );
}
