# Node Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read full node contents and JSON Path by clicking a preview node.

**Architecture:** Connect the pinned renderer callback to a local accessible dialog. Keep source-to-node resolution separate from dialog presentation and preserve GraphView render-completion and App last-good-data semantics.

**Tech Stack:** React, TypeScript, jsoncrack-react 1.0.5, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-11-03-node-details-design.md

## Global Constraints

- Preserve local-only preview behavior, existing input limits, rendering controls, and file-save semantics.
- Display node-local content as formatted JSON, including meaningful primitives and empty containers.
- JSON Path must preserve array indices and escape unusual property names; no incorrect fallback root path.
- No dependency upgrades, external edit action, push, or publication.
- Close on valid graph replacement; invalid saves preserve last-good details.
- Report actual verification in docs/validation.md; never mark unverified checks passed.

## Review Focus

- Nested arrays: renderer 1.0.5 supplies an empty path for nested array nodes; resolve true indices from source/graph relationships.
- Container-only objects and empty values: show meaningful data without renderer placeholders or accidentally including unrelated descendants.
- Async copy after close or replacement: no stale success feedback or false success on failure.
- Focus after renderer remount: restore to a surviving, useful target; modal must trap keyboard focus.
- Long malicious-looking text and unusual keys: full literal values, correct paths, no HTML execution or external requests.

### Task 1: Implement and ship node details

**Files:**
- Create: web/src/nodeDetails.ts, web/src/NodeDetailsDialog.tsx and focused tests in web/tests/.
- Modify: web/src/GraphView.tsx, web/src/GraphView.css, web/tests/renderer/main.tsx, web/tests/renderer.spec.ts, web/tests/e2e/preview.spec.ts as needed.
- Update: README.md, README.ja.md, doc/jsoncrack.txt, docs/validation.md, dist/ generated artifacts.

**Interfaces:** Consume JSONCrack onNodeClick NodeData, onParse GraphData, and the current source JSON. Produce an internal NodeDetails value with content and formatted path strings, consumed by NodeDetailsDialog with an onClose callback. Internal helper signatures may be chosen to fit pinned renderer metadata; validate relationships rather than assuming node.path is correct.

- [x] Add failing focused tests proving long primitive values, node-local object properties, arrays, empty containers, nested arrays with distinct indices, and escaped keys resolve to exact content/path. Run tests and record the expected failure before implementation.
- [x] Implement source/graph detail resolution in nodeDetails.ts. Inspect pinned parser behavior; preserve actual types and never substitute renderer placeholder strings for content.
- [x] Add failing dialog/lifecycle tests for click, text safety, close button/Escape/backdrop, focus trapping/restoration, separate copy success/failure, and valid replacement versus invalid-save retention.
- [x] Implement accessible dialog and GraphView integration, including empty root activation. Use existing dark styling; keep complete content selectable and scrollable within narrow viewports.
- [x] Add real renderer tests in Chromium and Firefox for long content, nested arrays/unusual keys, empty roots, copy/keyboard close, and save lifecycle. Assert existing CSP/network constraints. Capture a screenshot of the open dialog for visual inspection.
- [x] Run focused tests, then update both READMEs and vimdoc with node-details usage. Record test evidence and limitations in docs/validation.md.
- [x] Rebuild dist, stage generated files, and run the sequential checks with pinned Node/npm and available Lua tools. The first make check stopped at E2E with a stale-bundle/locator issue; corrected full E2E passed, and post-commit make verify-dist passed. Browser servers and builds were run sequentially.
- [x] Self-review and commit only task files, excluding the existing untracked .nvimlog. Report commits, exact commands/results, screenshot path, and any remaining concerns for independent review.
