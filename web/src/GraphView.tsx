import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { JSONCrack, type GraphData } from "jsoncrack-react";
import "jsoncrack-react/style.css";

const MAX_RENDERABLE_NODES = 1500;
const GRAPH_HEIGHT = "600px";

type EmptyRoot = "object" | "array";
type GraphState = {
  version: number;
  json: string;
  graph: GraphData;
};
type ErrorBoundaryProps = {
  children: ReactNode;
  onError: (error: Error) => void;
};
type ErrorBoundaryState = { error: Error | null };

class GraphErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert">
          Unable to render JSON graph: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function getEmptyRoot(json: string): EmptyRoot | null {
  try {
    const value: unknown = JSON.parse(json);
    if (Array.isArray(value) && value.length === 0) return "array";
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      return "object";
    }
  } catch {
    // The official component reports malformed JSON through onParseError.
  }
  return null;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function GraphView({
  json,
  onRendered,
  onRenderError,
}: {
  json: string;
  onRendered?: () => void;
  onRenderError?: (message: string) => void;
}): ReactElement {
  const currentJsonRef = useRef(json);
  const versionRef = useRef(0);
  if (currentJsonRef.current !== json) {
    currentJsonRef.current = json;
    versionRef.current += 1;
  }
  const version = versionRef.current;
  const hostRef = useRef<HTMLDivElement>(null);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const renderedVersionRef = useRef<number | null>(null);
  const parseErrorVersionRef = useRef(-1);
  const [parsed, setParsed] = useState<GraphState | null>(null);
  const [parseError, setParseError] = useState<{
    version: number;
    message: string;
  } | null>(null);
  const emptyRoot = useMemo(() => getEmptyRoot(json), [json]);
  const notifyRendered = useCallback((completedVersion: number) => {
    if (renderedVersionRef.current === completedVersion) return;
    renderedVersionRef.current = completedVersion;
    onRenderedRef.current?.();
  }, []);

  const handleParse = useCallback(
    (graph: GraphData) => {
      if (
        versionRef.current !== version ||
        currentJsonRef.current !== json ||
        parseErrorVersionRef.current === version
      ) {
        return;
      }
      setParsed({ version, json, graph });
    },
    [json, version],
  );

  const handleParseError = useCallback(
    (error: Error) => {
      if (versionRef.current !== version || currentJsonRef.current !== json) return;
      parseErrorVersionRef.current = version;
      const message = error.message || "The input could not be parsed.";
      setParseError({ version, message });
      onRenderError?.(message);
    },
    [json, onRenderError, version],
  );

  const handleRenderError = useCallback(
    (value: Error) => {
      if (versionRef.current !== version || currentJsonRef.current !== json) return;
      const error = toError(value);
      setParseError({ version, message: error.message });
      onRenderError?.(error.message);
    },
    [json, onRenderError, version],
  );

  useEffect(() => {
    if (emptyRoot && versionRef.current === version && currentJsonRef.current === json) {
      notifyRendered(version);
    }
  }, [emptyRoot, json, notifyRendered, version]);

  useEffect(() => {
    if (
      !parsed ||
      parsed.version !== version ||
      parsed.json !== json ||
      parsed.graph.nodes.length > MAX_RENDERABLE_NODES
    ) {
      return;
    }

    const host = hostRef.current;
    if (!host) return;
    let active = true;
    let completionQueued = false;
    let firstFrame = 0;
    let secondFrame = 0;

    const completeAfterPaint = (): void => {
      if (completionQueued) return;
      const svg = host.querySelector("svg");
      if (!svg || svg.querySelectorAll("g").length === 0) return;
      completionQueued = true;
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (
            !active ||
            versionRef.current !== version ||
            currentJsonRef.current !== json
          ) {
            return;
          }
          notifyRendered(version);
        });
      });
    };

    const observer = new MutationObserver(completeAfterPaint);
    observer.observe(host, { childList: true, subtree: true });
    completeAfterPaint();
    const interval = window.setInterval(completeAfterPaint, 32);

    return () => {
      active = false;
      observer.disconnect();
      window.clearInterval(interval);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [json, notifyRendered, parsed, version]);

  const currentError = parseError?.version === version ? parseError : null;

  return (
    <div
      ref={hostRef}
      data-testid="graph"
      data-theme="dark"
      style={{ height: GRAPH_HEIGHT, width: "100%" }}
    >
      {currentError ? (
        <div role="alert">Unable to render JSON graph: {currentError.message}</div>
      ) : emptyRoot ? (
        <div role="status">
          {emptyRoot === "object" ? "Empty JSON object {}" : "Empty JSON array []"}
        </div>
      ) : (
        <GraphErrorBoundary key={version} onError={handleRenderError}>
          <JSONCrack
            key={version}
            json={json}
            theme="dark"
            maxRenderableNodes={MAX_RENDERABLE_NODES}
            showControls
            showGrid
            centerOnLayout
            style={{ height: "100%", width: "100%" }}
            onParse={handleParse}
            onParseError={handleParseError}
            renderNodeLimitExceeded={(nodeCount, limit) => (
              <div role="status">
                Too large to render: {nodeCount} nodes; limit is {limit}.
              </div>
            )}
          />
        </GraphErrorBoundary>
      )}
    </div>
  );
}
