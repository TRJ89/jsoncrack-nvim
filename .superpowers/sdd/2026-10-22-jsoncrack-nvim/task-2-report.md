# Task 2 implementation report

Implemented strict JSON/YAML validation and JSON normalization for the browser preview.

## Changes

- Added the shared `Format`, `ParseResult`, `ParseError`, and `Snapshot` exports in `web/src/types.ts`.
- Added `parseSource` in `web/src/parse.ts`. JSON is parsed with `jsonc-parser` strict options and its AST is checked for duplicate decoded keys, nesting depth, and numeric safety before conversion. YAML is parsed as a single YAML 1.2 Core `Document`; errors, warnings, directives, tags, anchors, aliases, mapping keys, duplicates, merge keys, depths, and scalar values are checked before conversion.
- Numeric checks inspect source tokens or YAML `BigInt` values before precision loss. Conversion builds arrays and null-prototype objects and serializes only JSON-compatible values.
- Added 43 Vitest cases in `web/tests/parse.test.ts` and a Vitest config that excludes the separate Playwright `*.spec.ts` suite.
- Pinned direct dependencies: `jsonc-parser` 3.3.1 and `yaml` 2.9.1; pinned test dependency `vitest` 5.0.5. Existing React 18.3.1, Vite 8.3.5, and TypeScript 7.0.2 pins are unchanged.

## Current documentation and package checks

- [Microsoft jsonc-parser API](https://github.com/microsoft/node-jsonc-parser#api) documents strict parse options, `parseTree`, node offsets, and syntax errors. [npm package record](https://www.npmjs.com/package/jsonc-parser) reported 3.3.1 as latest stable; 4.0.0-next is prerelease.
- [eemeli YAML documentation](https://eemeli.org/yaml/) documents the Document/AST APIs, source ranges, warnings, `intAsBigInt`, and line counters. [npm package record](https://www.npmjs.com/package/yaml) reported 2.9.1 as current.
- [Vitest 5 migration requirements](https://vitest.dev/guide/migration/) require Vite >=6.4 and Node >=22.12. This project’s existing Vite 8.3.5 and Node 22.19.0 satisfy them. [npm package record](https://www.npmjs.com/package/vitest) reported 5.0.5 as current.

## Test-driven evidence and verification

- RED: `npm --prefix web test -- tests/parse.test.ts` first showed the expected missing `parse.ts` module. After adding a temporary export-only placeholder, the same command reached the assertions and failed 20 of 43 tests on missing parsing, normalization, source positions, and required error codes.
- GREEN: `npm --prefix web test -- tests/parse.test.ts` passed 43/43 after implementation.
- `npm --prefix web test` passed 43/43.
- `npm --prefix web run typecheck` passed.
- `npm --prefix web run test:renderer` passed 22/22 across Chromium and Firefox.
- `git diff --check` passed.

The first unprivileged Vitest invocation could not write Vite’s temporary config bundle under the assigned worktree’s read-only mount; rerunning with the authorized worktree write permission succeeded. The renderer suite printed `NO_COLOR`/`FORCE_COLOR` environment notices and Vite’s existing large-chunk advisory; all renderer checks passed.

## Self-review

No renderer source or existing renderer dependency pins changed. YAML parser warnings fail closed as specified. Object keys are copied as own data properties, so prototype-sensitive names remain ordinary input data. Decimal fraction values follow JavaScript `Number` precision; exact unsafe integers and non-finite numbers are rejected. The parser receives decoded JavaScript strings, so strict byte decoding remains the responsibility of the source-loading boundary.

Commit subject requested by the task: `feat: validate JSON and YAML preview input`.
