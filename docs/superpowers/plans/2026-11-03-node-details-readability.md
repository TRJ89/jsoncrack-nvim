# Node details readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Make node details readable using unwrapped highlighted JSON and a larger responsive dialog.
**Architecture:** Refine existing dialog presentation; a small dependency-free JSON text highlighter preserves exact characters.
**Tech Stack:** React, TypeScript, CSS, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-11-03-node-details-readability-design.md

## Global Constraints
- Preserve exact source content/path/copy and save lifecycle; render only escaped React text.
- No dependencies, graph/resolver changes, pushes, or unrelated refactors.
- Preserve user .nvimlog; same checkout branch for SSH accessibility.

## Review Focus
- Long Japanese values scroll horizontally; many fields vertically.
- Highlight spans preserve text/escaping and do not create markup.
- Controls remain reachable on narrow and short screens, including long paths.
- Clipboard and focus remain correct when content is focusable for scrolling.

### Task 1: Improve content readability and responsive sizing
**Files:** web/src/NodeDetailsDialog.tsx, web/src/GraphView.css, optional web/src/JsonContent.tsx; web/tests/NodeDetailsDialog.test.tsx, web/tests/renderer/main.tsx, web/tests/renderer.spec.ts; README.md, README.ja.md, doc/jsoncrack.txt, docs/validation.md and dist/.
**Interfaces:** Existing NodeDetails content/path strings unchanged; highlight component consumes a string and renders exactly that text in spans.
- [x] Add failing browser assertions for a Japanese long-value/many-fields fixture: actual horizontal/vertical overflow and scrolling, larger responsive width/height, reachable controls at desktop, 360x500 and short landscape. Add focused highlight tests for escaping, literals and exact text.
- [x] Implement unwrapped, syntax-colored JSON text and responsive dialog sizing. Make content keyboard-scrollable and retain focus trap, full text selection, exact copying and safe text-only rendering. Use remaining dialog height instead of a small content cap; avoid clipping controls.
- [x] Run unit tests/typecheck and real renderer suite sequentially on both browsers. Capture full-page screenshots with long Japanese contents at desktop and narrow viewport, using app styling in harness where appropriate. Avoid synthetic or forced node clicks.
- [x] Update user docs and validation evidence, build dist BEFORE preview E2E, run E2E suite once to confirm real distributed app, commit regenerated assets then verify-dist (compares HEAD). Record failures honestly.
- [x] Self-review and commit task files, leaving .nvimlog untouched. Report test results and screenshots for independent review.
