# Release Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Apply the user's approved toolchain and public-facing documentation changes, then validate the updated build environment.

**Architecture:** Update development toolchain pins and documentation together. Keep plugin runtime behavior, public API, and locked dependency versions unchanged.

**Tech Stack:** Node.js 22.23.4, npm 10.9.9, existing Neovim/Python/React tests.

**Spec:** The user's approved 2026-10-24 follow-up supersedes the README key example in the original MVP spec: use `<leader>cj`, explicitly identify the integration as unofficial, and invite environment-support issues without promising support.

## Global Constraints

- Node.js 22.23.4 and npm 10.9.9 must match across `.node-version`, package metadata, lockfile root metadata, CI, and current documentation.
- Node/npm remain development-only; runtime requires no install-time build.
- The plugin registers no default keymap. Only the documented user configuration changes to `<leader>cj`.
- Preserve historical validation results and their original versions/key mappings. Add dated results for new checks.
- Preserve dependency versions/integrities and license text. Do not publish or change user Neovim configuration.

## Review Focus

- Version mismatch between local metadata and CI: inspect all current pins and execute the exact new versions.
- Lockfile churn: compare dependency entries before/after; update only root toolchain metadata unless a concrete tooling requirement is demonstrated.
- Documented key behavior: load the README configuration in an isolated Neovim/lazy.nvim setup and verify `<leader>cj` invokes Toggle; keep plugin source free of keymaps.
- Official-affiliation ambiguity: make the non-affiliation statement prominent and clearly distinguish the upstream renderer from this plugin.
- Validation overclaim: run checks sequentially, record failures and exact outcomes, and retain the remote-CI/performance limitations.

## Task 1: Update toolchain pins and release documentation

**Files:** Modify `.node-version`, `web/package.json`, `web/package-lock.json`, `.github/workflows/ci.yml`, `README.md`, `doc/jsoncrack.txt`, `docs/validation.md`. Add a dated amendment to `docs/superpowers/specs/2026-10-22-jsoncrack-nvim-design.md` stating that current examples use `<leader>cj`; preserve the original text as historical design. Generated `dist/` changes only if rebuilding demonstrates a necessary difference.

**Interfaces:** Existing `make lint`, `make test`, `make build`, and `make verify-dist`; no runtime interface changes.

- [x] Update the exact development version pins, including lockfile root engines, without upgrading dependency packages.
- [x] Replace CI's unavailable Selene 0.32.0 Cargo install with the official checksum-verified Linux archive; execute the step with disposable runner paths and verify the installed version.
- [x] Add to the README introduction: “An unofficial Neovim integration for JSON Crack. This project is not affiliated with or endorsed by the JSON Crack project.” Keep the official renderer attribution clear.
- [x] Change current README/vimdoc key examples and usage to `<leader>cj`, indicate that users can choose another key, and add the dated spec amendment.
- [x] Invite support requests through issues describing OS, Neovim setup, and use case, explicitly stating that support is not guaranteed. Keep the existing supported-environment boundary.
- [x] Under Node.js 22.23.4/npm 10.9.9, install using `npm ci`, run `make check` sequentially, and check the README mapping/help in an isolated configuration. No new cosmetic/static-content tests are needed.
- [x] Record exact versions, suite results, distribution reproducibility, and mapping smoke evidence in `docs/validation.md`; preserve prior measurements.
- [x] Self-review and commit only the scoped changes, then hand the diff and evidence to the independent reviewer.
