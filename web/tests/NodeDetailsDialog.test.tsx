import { useState, type ReactElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeDetailsDialog } from "../src/NodeDetailsDialog";
import type { NodeDetails } from "../src/nodeDetails";

const firstDetails: NodeDetails = {
  content: '{\n  "value": "first"\n}',
  path: "$.first",
};

function DismissibleDialog({
  details = firstDetails,
  fallbackFocus,
}: {
  details?: NodeDetails;
  fallbackFocus?: () => HTMLElement | null;
}): ReactElement | null {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <NodeDetailsDialog
      details={details}
      onClose={() => setOpen(false)}
      fallbackFocus={fallbackFocus}
    />
  );
}

function setClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("NodeDetailsDialog", () => {
  it("renders complete content as selectable text without creating markup", () => {
    const content = '"<img src=x onerror=\"window.__xss=true\">"';
    const { container } = render(
      <NodeDetailsDialog details={{ content, path: "$" }} onClose={() => undefined} />,
    );

    expect(screen.getByText(content)).toBeInTheDocument();
    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.getByText(content).closest("pre")).toHaveStyle({ userSelect: "text" });
  });

  it("closes from the close button", () => {
    const onClose = vi.fn();
    render(<NodeDetailsDialog details={firstDetails} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close node details" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<NodeDetailsDialog details={firstDetails} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on backdrop clicks but keeps clicks inside the dialog open", () => {
    const onClose = vi.fn();
    render(<NodeDetailsDialog details={firstDetails} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement;
    if (!backdrop) throw new Error("Dialog backdrop is missing.");

    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("traps Tab focus and restores the prior focus after closing", () => {
    const opener = document.createElement("button");
    opener.textContent = "Open details";
    document.body.appendChild(opener);
    opener.focus();

    try {
      render(<DismissibleDialog />);
      const close = screen.getByRole("button", { name: "Close node details" });
      const copyContent = screen.getByRole("button", { name: "Copy content" });
      expect(close).toHaveFocus();

      fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
      expect(copyContent).toHaveFocus();
      fireEvent.keyDown(copyContent, { key: "Tab" });
      expect(close).toHaveFocus();

      fireEvent.click(close);
      expect(opener).toHaveFocus();
    } finally {
      opener.remove();
    }
  });

  it("restores focus to a fallback after the graph that opened it is removed", () => {
    const fallback = document.createElement("button");
    fallback.textContent = "Graph";
    document.body.appendChild(fallback);
    const removedOpener = document.createElement("button");
    document.body.appendChild(removedOpener);
    removedOpener.focus();
    const fallbackFocus = () => fallback;

    try {
      const view = render(<DismissibleDialog fallbackFocus={fallbackFocus} />);
      removedOpener.remove();
      fireEvent.click(screen.getByRole("button", { name: "Close node details" }));

      expect(view.queryByRole("dialog")).not.toBeInTheDocument();
      expect(fallback).toHaveFocus();
    } finally {
      fallback.remove();
      removedOpener.remove();
    }
  });

  it("copies content and path separately and reports each success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    render(<NodeDetailsDialog details={firstDetails} onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy content" }));
    await waitFor(() => expect(screen.getByText("Content copied.")).toBeInTheDocument());
    expect(writeText).toHaveBeenNthCalledWith(1, firstDetails.content);
    expect(screen.queryByText("Path copied.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() => expect(screen.getByText("Path copied.")).toBeInTheDocument());
    expect(writeText).toHaveBeenNthCalledWith(2, firstDetails.path);
  });

  it("reports both outcomes when content and path copies overlap", async () => {
    let resolvePath: (() => void) | undefined;
    let rejectContent: ((error: Error) => void) | undefined;
    const writeText = vi.fn((value: string) => {
      if (value === firstDetails.path) {
        return new Promise<void>((resolve) => { resolvePath = resolve; });
      }
      return new Promise<void>((_resolve, reject) => { rejectContent = reject; });
    });
    setClipboard(writeText);
    render(<NodeDetailsDialog details={firstDetails} onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy content" }));
    expect(writeText).toHaveBeenNthCalledWith(1, firstDetails.path);
    expect(writeText).toHaveBeenNthCalledWith(2, firstDetails.content);

    await act(async () => {
      resolvePath?.();
      rejectContent?.(new Error("clipboard denied"));
    });

    await waitFor(() => {
      expect(screen.getByText("Path copied.")).toBeInTheDocument();
      expect(screen.getByText("Could not copy content. Select and copy the text instead.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Could not copy path. Select and copy the text instead.")).not.toBeInTheDocument();
    expect(screen.queryByText("Content copied.")).not.toBeInTheDocument();
  });

  it("reports clipboard failure for the requested field without success feedback", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("clipboard denied")));
    render(<NodeDetailsDialog details={firstDetails} onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));

    await waitFor(() =>
      expect(screen.getByText("Could not copy path. Select and copy the text instead.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Path copied.")).not.toBeInTheDocument();
    expect(screen.queryByText("Could not copy content. Select and copy the text instead.")).not.toBeInTheDocument();
  });

  it("ignores clipboard completion after the dialog closes", async () => {
    let finishCopy: (() => void) | undefined;
    setClipboard(() => new Promise<void>((resolve) => { finishCopy = resolve; }));
    const view = render(<DismissibleDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Copy content" }));
    fireEvent.click(screen.getByRole("button", { name: "Close node details" }));
    await act(async () => finishCopy?.());

    expect(view.queryByRole("dialog")).not.toBeInTheDocument();
    expect(view.queryByText("Content copied.")).not.toBeInTheDocument();
  });

  it("ignores clipboard completion for details replaced while the copy is pending", async () => {
    let finishCopy: (() => void) | undefined;
    setClipboard(() => new Promise<void>((resolve) => { finishCopy = resolve; }));
    const view = render(
      <NodeDetailsDialog details={firstDetails} onClose={() => undefined} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy content" }));
    view.rerender(
      <NodeDetailsDialog
        details={{ content: '{"value":"replacement"}', path: "$.replacement" }}
        onClose={() => undefined}
      />,
    );
    await act(async () => finishCopy?.());

    expect(screen.queryByText("Content copied.")).not.toBeInTheDocument();
    expect(screen.queryByText("Could not copy content. Select and copy the text instead.")).not.toBeInTheDocument();
  });
});
