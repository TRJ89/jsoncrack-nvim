import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { GraphView } from "../../src/GraphView";

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
    case "limit":
      return JSON.stringify(Array.from({ length: 1501 }, (_, index) => index));
    case "error-recovery":
      return "{broken";
    case "markup":
      return JSON.stringify('<img src=x onerror="window.__xss=true">');
    case "current-input":
      return JSON.stringify({ stale: Array.from({ length: 100 }, (_, index) => index) });
    default:
      return JSON.stringify("unknown fixture");
  }
}

type Completion = { phase: "before-change" | "after-change"; json: string };

function RendererHarness(): ReactElement {
  const fixtureName = new URLSearchParams(window.location.search).get("case") ?? "string";
  const [json, setJson] = useState(() => fixture(fixtureName));
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const changedRef = useRef(false);

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
    setCompletions((current) => [
      ...current,
      { phase: changedRef.current ? "after-change" : "before-change", json },
    ]);
  }, [json]);
  const handleRenderError = useCallback((message: string) => {
    setErrors((current) => [...current, message]);
  }, []);

  return (
    <main>
      <GraphView json={json} onRendered={handleRendered} onRenderError={handleRenderError} />
      <div data-testid="rendered-inputs">
        {completions.map((completion, index) => (
          <span key={`${completion.phase}-${index}`} data-phase={completion.phase}>
            {completion.json}
          </span>
        ))}
      </div>
      <div data-testid="render-errors">{errors.join("\n")}</div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Renderer fixture root is missing.");
createRoot(root).render(<RendererHarness />);
