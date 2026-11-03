# Node Details — Approved Design

Status: approved by the user on 2026-11-03.

## Intent

Click a graph node to read values that are truncated in the graph. The user's reference is the JSON Crack Content / JSON Path modal. Preserve local-only preview behavior, existing input limits, rendering controls, and file-save semantics.

## Approaches

- Recommended: a modal dialog, matching the supplied screenshot, with scrollable full content and JSON Path. It focuses reading on the selected node without permanently reducing graph space.
- Alternative: a persistent side panel, useful for comparing multiple nodes but consuming graph width and differing from the supplied reference.

## Approved behavior

- Clicking a node opens an accessible modal with its untruncated content, formatted as JSON. YAML values use the parsed JSON representation already used for the graph.
- Match the screenshot's node-local content: display the values belonging to that node, rather than automatically expanding every descendant. Empty containers and primitive nodes have meaningful content instead of renderer placeholder strings. Array/container-only nodes need explicit coverage in implementation tests.
- Show the node's JSON Path, correctly escaping unusual property names and preserving array indices. Verify the pinned renderer's path metadata against real fixtures, especially nested arrays; do not show an incorrect fallback root path.
- Provide separate copy buttons for content and path. Report clipboard failure without claiming a successful copy; text remains selectable.
- Long values remain complete, wrap or scroll within the dialog, and are rendered as text, never evaluated as HTML.
- Close with the close button, Escape, or a backdrop click. Keep keyboard focus inside the open modal and restore focus appropriately when it closes.
- Close the dialog when a new valid graph replaces the current graph, so selection does not silently point at another node. Invalid saves retain the last valid graph and its details under the application's existing last-valid-data warning.
- The external editing button shown in the reference is outside this local preview feature.

## Integration and verification

The installed jsoncrack-react 1.0.5 exposes onNodeClick and NodeData.text/path; GraphView currently does not subscribe. Add the detail UI around that callback without replacing the renderer or upgrading dependencies. Handle existing empty-root fallback UI consistently.

Verify long strings, objects, primitive/array values, unusual property names, nested arrays, safe markup display, close/focus/copy behavior, and save-time invalidation. Use Chromium and Firefox real renderer tests in addition to focused component tests. Rebuild and verify the committed distribution, update English/Japanese user docs and vimdoc, and record actual evidence in docs/validation.md. Preserve all existing regressions and no-network/CSP behavior. No push or publication is included.
