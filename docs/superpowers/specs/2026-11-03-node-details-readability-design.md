# Node details readability

The user requests a readable, scrollable content view rather than wrapped raw JSON, and prefers a larger dialog that adapts to the viewport. This is a presentation refinement of the approved node-details feature; data selection, copy semantics, and dismissal stay the same.

Current cause: content uses `white-space: pre-wrap` and `overflow-wrap: anywhere`; dialog width is capped at 680px and content height at 48vh.

Implementation choices: keep formatted JSON, disable automatic wrapping, provide horizontal and vertical scrolling, and distinguish keys, strings, numbers and literals with accessible dark-theme colors. Render tokens as React text, never HTML; copying and text selection must retain exactly the existing formatted JSON. No new dependency. Use most of the viewport with small margins (roughly 94vw/92vh), allowing content to occupy remaining height. Retain bounded long-path scrolling, usable controls on narrow/short screens, and existing keyboard dismissal/focus behavior. A separate structured table or JSON editor would add unnecessary behavior; neither is needed for this refinement.

Verify a screenshot-like Japanese long-string fixture on desktop, narrow and short viewports in Chromium and Firefox. Check actual scrolling in both axes, exact text and copy data, safe markup, color differentiation, visible controls and larger responsive dimensions. Rebuild distribution and record only observed evidence in docs/validation.md.
