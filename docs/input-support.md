# Input support and performance

[English README](../README.md) · [日本語 README](../README.ja.md)

The preview validates each saved file before sending it to the graph renderer.
Unsupported or invalid input produces an explicit error; the preview does not
draw a partial graph.

## File and size limits

- The target must be a saved, readable regular file named with `.json`,
  `.yaml`, or `.yml`. JSONC and other file types are unsupported.
- Input is limited to 1 MiB (1,048,576 bytes), including a UTF-8 byte order
  mark. UTF-8 is required; one leading UTF-8 BOM is removed.
- Maximum nesting depth is 100. The root container counts as depth 1.
- The graph is limited to 1,500 rendered nodes. Larger graphs show an explicit
  limit error instead of a partial result.

## JSON

Supported values are standard JSON objects, arrays, strings, finite numbers,
booleans, and `null`.

The parser rejects comments, trailing commas, duplicate object keys, multiple
roots, empty input, unsafe integers, and non-finite numbers. Decimal fractions
use JavaScript number precision.

## YAML

Supported input is one YAML 1.2 Core document with string mapping keys,
sequences, strings, finite numbers, booleans, and `null`. Comments, quoted and
multiline strings, and flow collections are supported.

The parser rejects multiple documents, YAML 1.1 directives, custom or explicit
tags, anchors, aliases, non-string or duplicate mapping keys, the merge key
`<<`, and non-finite numbers. Under YAML 1.2 Core, values such as `yes`, `no`,
and date-like scalars are strings. Empty or comment-only YAML is reported as
an empty document; explicit `null` and `~` are null values.

## Measured performance

The measured target is a foreground browser, a local file no larger than
100 KiB, at most 300 rendered nodes, and nearest-rank p95 of at most 1,000 ms
across 20 saves. On the validation fixture (7,111 bytes and 67 rendered nodes),
the measured p95 was 526.674 ms in Playwright Chromium 156.0.8078.4 and
911.385 ms in Playwright Firefox 157.0 on a headed virtual X11 desktop. These
are measurements from that environment, not guarantees for larger files,
background tabs, or physical displays. The [validation record](validation.md#performance-method-and-results)
describes the method and environment.
