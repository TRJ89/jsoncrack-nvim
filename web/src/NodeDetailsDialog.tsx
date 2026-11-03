import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { NodeDetails } from "./nodeDetails";
import "./GraphView.css";

type CopyField = "content" | "path";

type Props = {
  details: NodeDetails;
  onClose: () => void;
  fallbackFocus?: () => HTMLElement | null;
};

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getAttribute("aria-hidden") !== "true");
}

export function NodeDetailsDialog({ details, onClose, fallbackFocus }: Props): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fallbackFocusRef = useRef(fallbackFocus);
  const detailsRef = useRef(details);
  const mountedRef = useRef(false);
  const copyRequestRef = useRef(0);
  const [feedback, setFeedback] = useState<Partial<Record<CopyField, string>>>({});
  fallbackFocusRef.current = fallbackFocus;
  detailsRef.current = details;

  useEffect(() => {
    const activeElement = document.activeElement;
    const previousFocus = activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      activeElement !== document.documentElement
      ? activeElement
      : null;
    mountedRef.current = true;
    closeButtonRef.current?.focus();

    return () => {
      mountedRef.current = false;
      copyRequestRef.current += 1;
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      } else {
        fallbackFocusRef.current?.()?.focus();
      }
    };
  }, []);

  useEffect(() => {
    copyRequestRef.current += 1;
    setFeedback({});
  }, [details]);

  const close = (): void => {
    copyRequestRef.current += 1;
    onClose();
  };

  const copy = async (field: CopyField): Promise<void> => {
    const value = field === "content" ? details.content : details.path;
    const requestedDetails = details;
    const request = ++copyRequestRef.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value);
      if (
        mountedRef.current &&
        request === copyRequestRef.current &&
        detailsRef.current === requestedDetails
      ) {
        setFeedback((current) => ({
          ...current,
          [field]: field === "content" ? "Content copied." : "Path copied.",
        }));
      }
    } catch {
      if (
        mountedRef.current &&
        request === copyRequestRef.current &&
        detailsRef.current === requestedDetails
      ) {
        setFeedback((current) => ({
          ...current,
          [field]: field === "content"
            ? "Could not copy content. Select and copy the text instead."
            : "Could not copy path. Select and copy the text instead.",
        }));
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = focusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="node-details-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="node-details-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="node-details-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="node-details-header">
          <h2 id="node-details-title">Node Details</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="node-details-close"
            aria-label="Close node details"
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="node-details-path-row">
          <div className="node-details-path">
            <span id="node-details-path-label" className="node-details-label">JSON Path</span>
            <code aria-labelledby="node-details-path-label" tabIndex={0}>{details.path}</code>
          </div>
          <button type="button" onClick={() => void copy("path")}>Copy path</button>
        </div>
        {feedback.path && <div className="node-details-feedback" aria-live="polite">{feedback.path}</div>}
        <section className="node-details-content-section" aria-labelledby="node-details-content-label">
          <div className="node-details-content-heading">
            <span id="node-details-content-label" className="node-details-label">Content</span>
            <button type="button" onClick={() => void copy("content")}>Copy content</button>
          </div>
          {feedback.content && <div className="node-details-feedback" aria-live="polite">{feedback.content}</div>}
          {details.omittedChildContainers && (
            <p className="node-details-note">Child containers are shown as separate nodes.</p>
          )}
          <pre className="node-details-content" style={{ userSelect: "text" }}>
            {details.content}
          </pre>
        </section>
      </div>
    </div>
  );
}
