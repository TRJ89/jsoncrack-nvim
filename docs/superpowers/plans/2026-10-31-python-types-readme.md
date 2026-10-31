# Python Type Checks and Bilingual README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Resolve the reported Pyright diagnostics, enforce Python type checks locally and in CI, and provide natural English/Japanese installation documentation.

**Architecture:** Keep runtime behavior intact; express existing invariants with accurate types and explicit checks. Reuse the locked npm development toolchain for Pyright. Keep reader-facing READMEs short and move detailed contributor instructions into docs.

**Tech Stack:** Python 3.10+, Pyright 1.1.407, Node.js 22.23.4/npm 10.9.9, Neovim/lazy.nvim.

**Spec:** User approved the diagnosed type fixes and make check/CI integration, requested a conventional README modeled on existing Neovim plugins and a Japanese version, and delegated repository naming. Prior MVP design remains binding for runtime behavior.

## Global Constraints

- Preserve Python 3.10+ runtime compatibility and Linux desktop/LazyVim support scope; no new Python runtime dependencies.
- Node.js 22.23.4/npm 10.9.9 remain development-only. Pin Pyright 1.1.407 as a development dependency; preserve unrelated package versions and distribution assets.
- Check server/, scripts/, and tests/ with Pyright, using explicit Linux/Python 3.10 configuration and standard checking; no blanket suppressions, file exclusions of owned Python code, or broad Any/casts merely to silence errors.
- Preserve negative startup/error tests: ready/client/pipe guards must be placed where their invariant is actually guaranteed, not where failure responses are expected.
- Preserve the three commands and optional example <leader>cj; no setup/build hook or default mapping is required.
- Use planned repository TRJ89/jsoncrack-nvim, but state it is not published yet; no repository creation, push, or release.
- Preserve unofficial/nonaffiliated attribution, limits, disk-save semantics, support-request caveat and license links in both languages or linked detailed docs. Record only checks actually run.

## Review Focus

- Optional ready/client states in deliberately invalid-startup tests must remain possible and tested.
- HTTP handler type corrections must retain address validation and method dispatch behavior.
- Type checking must run from a fresh npm ci via make check/CI, without a globally installed Mason executable.
- English/Japanese examples must agree and remain valid lazy.nvim specs; published status must not be invented.
- Documentation simplification must retain accurate runtime requirements, scope and input limits through accessible links.

## Task 1: Fix Python types and enforce checking

**Files:** server/http_server.py; tests/python/support.py; tests/python/test_http.py; tests/python/test_process.py; other owned Python files only if the configured checker reveals diagnostics; new pyrightconfig.json; web/package.json; web/package-lock.json; Makefile; .github/workflows/ci.yml; docs/validation.md.

**Interfaces:** npm --prefix web run typecheck:python uses local pinned Pyright with --project ../pyrightconfig.json. make lint-python runs Python syntax checking and this type check; make check and existing full CI consume it.

- [x] Reproduce baseline diagnostics using installed Pyright 1.1.407; capture RED output before fixes. Add configuration and locked dev dependency, then run configured checker before correcting Python code.
- [x] Configure include server/scripts/tests and import resolution for unittest support modules without changing runtime imports solely for checker convenience. Set pythonVersion 3.10, pythonPlatform Linux, typeCheckingMode standard.
- [x] Correct handler signature/HTTP server typing and model/check optional subprocess pipes and ready/client states at their valid lifecycle boundaries. Do not convert negative-test startup expectations into successful-start assertions.
- [x] Add npm typecheck:python and make lint-python integration; ensure CI explicitly uses installed locked Pyright (version assertion appropriate) and fails on diagnostics. Keep unrelated dependencies unchanged.
- [x] Run configured Pyright to zero diagnostics, Python and integration regression tests, then one sequential full make check using pinned Node/npm. Record baseline and final counts, warnings and environment limits in docs/validation.md. For any real behavioral change, add a focused failing regression test before implementing it; existing failing checker is the regression for type-only changes.
- [x] Prove make lint-python rejects a temporary type mismatch in a disposable owned Python fixture, remove it, and confirm clean check. Do not introduce a permanent implementation-mirroring test for make syntax.
- [x] Self-review, commit scoped changes and report evidence.

## Task 2: Write natural English/Japanese user documentation

**Files:** README.md; new README.ja.md; new docs/development.md; new docs/input-support.md if needed to keep full input contract; doc/jsoncrack.txt for consistency with installation guidance; docs/validation.md append focused documentation verification; this plan checkboxes.

**Interfaces:** Consume Task 1's npm typecheck:python / make lint-python and dependency pins. Main install example is a complete lazy.nvim/LazyVim spec using TRJ89/jsoncrack-nvim with cmd and optional <leader>cj key; local dir alternative belongs in development docs.

- [ ] Use the information architecture of upstream READMEs, not copied prose: https://github.com/folke/trouble.nvim, https://github.com/stevearc/oil.nvim, https://github.com/iamcco/markdown-preview.nvim. Parent has fetched these and confirmed package-manager installation and quick-start patterns.
- [ ] Reorganize README around concise purpose/features, requirements, Installation (lazy.nvim, LazyVim config location), usage, limits, troubleshooting/support, development link and licensing. Clearly mark the remote example as planned until published; avoid unrequested extra package-manager examples or unsupported-platform promises.
- [ ] Add idiomatic Japanese README with equivalent instructions and reciprocal language links. Preserve technical facts and constraints, while linking full detailed input rules and measured performance evidence instead of burying installation under them.
- [ ] Move contributor toolchain, local-checkout loading, full commands and pre-publication notes into docs/development.md; retain complete input-support contract in user docs or docs/input-support.md. Update vimdoc's install guidance consistently without broad rewrite.
- [ ] Verify local links, syntax of both Lua examples, and isolated lazy.nvim loading with only repository identifier replaced by local dir. Check optional key/commands and help lookup without touching user configuration; report headless/browser-stub limits honestly. Do not repeat full suite for documentation-only edits.
- [ ] Append dated evidence, mark plan checkboxes, self-review and commit scoped changes.
