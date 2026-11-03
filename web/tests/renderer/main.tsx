import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { GraphView } from "../../src/GraphView";
import "../../src/style.css";

function fixture(name: string): string {
  switch (name) {
    case "string":
      return JSON.stringify("hello");
    case "object":
      return JSON.stringify({ name: "Ada", active: true });
    case "array":
      return JSON.stringify(["first", "second"]);
    case "number":
      return JSON.stringify(42);
    case "boolean":
      return JSON.stringify(true);
    case "null":
      return JSON.stringify(null);
    case "empty-object":
      return JSON.stringify({});
    case "empty-array":
      return JSON.stringify([]);
    case "inline-empty-callback":
      return JSON.stringify({});
    case "inline-graph-callback":
      return JSON.stringify({ value: "rendered" });
    case "limit":
      return JSON.stringify(Array.from({ length: 1501 }, (_, index) => index));
    case "error-recovery":
      return "{broken";
    case "markup":
      return JSON.stringify('<img src=x onerror="window.__xss=true">');
    case "long-string":
      return JSON.stringify("complete node detail value ".repeat(24));
    case "readability":
      return JSON.stringify(Object.fromEntries(Array.from({ length: 42 }, (_, index) => [
        `日本語フィールド${String(index + 1).padStart(2, "0")}`,
        "これは長い日本語の値です。幅に合わせて折り返さず、内容全体を読み取れるようにします。".repeat(7),
      ])));
    case "details-object":
      return JSON.stringify({
        peer: { hidden: true },
        target: {
          count: 2,
          emptyObject: {},
          emptyArray: [],
          child: { enabled: true },
          items: [1],
        },
      });
    case "details-nested-array":
      return JSON.stringify({ 'a.b"c': [[{ value: "first" }], [{ value: "second" }]] });
    case "deep-details-path": {
      const key = `level.${"segment.".repeat(80)}`;
      return JSON.stringify({ [key]: { leaf: "deep value", nested: { hidden: true } } });
    }
    case "current-input":
      return JSON.stringify({ stale: Array.from({ length: 100 }, (_, index) => index) });
    case "collapse-update":
      return JSON.stringify({
        group: { nested: { leaf: "hidden" }, peer: "hidden" },
        updated: "before",
      });
    default:
      return JSON.stringify("unknown fixture");
  }
}

type Completion = {
  phase: "before-change" | "after-change";
  json: string;
  opacity: string;
  renderedNodeCount: number;
};

declare global {
  interface Window {
    __setRendererJson?: (json: string) => void;
  }
}

function RendererHarness(): ReactElement {
  const fixtureName = new URLSearchParams(window.location.search).get("case") ?? "string";
  const [json, setJson] = useState(() => fixture(fixtureName));
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [inlineCompletionCount, setInlineCompletionCount] = useState(0);
  const changedRef = useRef(false);
  const setJsonFromTest = useCallback((nextJson: string) => {
    changedRef.current = true;
    setJson(nextJson);
  }, []);
  const useInlineCallback =
    fixtureName === "inline-empty-callback" || fixtureName === "inline-graph-callback";

  useEffect(() => {
    window.__setRendererJson = setJsonFromTest;
    return () => {
      delete window.__setRendererJson;
    };
  }, [setJsonFromTest]);

  useEffect(() => {
    if (fixtureName === "error-recovery") {
      const timer = window.setTimeout(() => setJson(JSON.stringify("recovered")), 400);
      return () => window.clearTimeout(timer);
    }
    if (fixtureName === "current-input") {
      const timer = window.setTimeout(() => {
        changedRef.current = true;
        setJson(JSON.stringify("current input"));
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [fixtureName]);

  const handleRendered = useCallback(() => {
    const graph = document.querySelector<HTMLElement>('[data-testid="graph"]');
    const graphSpace = graph?.querySelector<HTMLElement>(".jsoncrack-space");
    const renderedNodeCount = graph?.querySelectorAll(
      'svg foreignObject[data-id^="node-"]',
    ).length ?? 0;
    setCompletions((current) => [
      ...current,
      {
        phase: changedRef.current ? "after-change" : "before-change",
        json,
        opacity: graphSpace ? window.getComputedStyle(graphSpace).opacity : "missing",
        renderedNodeCount,
      },
    ]);
  }, [json]);
  const handleRenderError = useCallback((message: string) => {
    setErrors((current) => [...current, message]);
  }, []);
  const onRendered = useInlineCallback
    ? () => setInlineCompletionCount((current) => current + 1)
    : handleRendered;

  return (
    <main className="preview-app">
      <section className="graph-region" aria-label="JSON graph preview">
        <GraphView json={json} onRendered={onRendered} onRenderError={handleRenderError} />
      </section>
      {useInlineCallback && (
        <div data-testid="inline-completion-count" style={{ display: "none" }}>
          {inlineCompletionCount}
        </div>
      )}
      <div data-testid="rendered-inputs" style={{ display: "none" }}>
        {completions.map((completion, index) => (
          <span
            key={`${completion.phase}-${index}`}
            data-phase={completion.phase}
            data-opacity={completion.opacity}
            data-rendered-node-count={completion.renderedNodeCount}
          >
            {completion.json}
          </span>
        ))}
      </div>
      <div data-testid="render-errors" style={{ display: "none" }}>{errors.join("\n")}</div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Renderer fixture root is missing.");
createRoot(root).render(<RendererHarness />);
