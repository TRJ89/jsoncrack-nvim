# Public readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Address the user-approved public-release review follow-ups without publishing.
**Architecture:** Harden existing CI, document a private security reporting route, verify the advertised minimum Neovim, and investigate exact dependency licensing evidence before making supported notice changes.
**Tech Stack:** GitHub Actions, Dependabot YAML, Neovim/Lua, Python, Node license generator.
**Spec:** User-approved review follow-ups in this conversation; existing runtime design remains unchanged.

## Global Constraints
- No push, repository creation, visibility change, contacting upstream maintainers, or release/tag creation.
- Preserve runtime behavior, dependencies, toolchain pins and .nvimlog; do not invent upstream copyright owners/years.
- Claims of GitHub settings or CI success require actual verification; inaccessible remote settings remain pending.
- Preserve public install instructions; release-readiness caveats belong in maintainer docs.
- Existing MIT project license stays unchanged.

## Review Focus
- Action SHA resolves to the intended currently used major version, with update comments.
- Dependabot supports both SHA-pinned Actions and private web npm lockfile without automatic merging.
- Reported Neovim minimum has concrete validation, not only a matrix entry.
- SECURITY policy does not promise a configured remote reporting feature or a response SLA without evidence.
- Supplemental license text preserves exact upstream provenance and does not make unsupported legal claims.

### Task 1: Harden CI and document private reporting
**Files:** .github/workflows/ci.yml, .github/dependabot.yml, SECURITY.md, README.md, README.ja.md, docs/development.md, docs/validation.md.
**Interfaces:** Keep existing make check and compatibility tests. Expand compatibility to include v0.11.0 with required failures; nightly remains optional. Use GitHub private vulnerability reporting by default unless user supplies another preference.
- [x] Resolve all existing action major tags to full official commit SHAs without major upgrades; retain major-version comments and least permissions. Disable checkout credential persistence where unused.
- [x] Add weekly grouped github-actions and npm /web Dependabot updates with supported cooldown settings; no auto-merge. Verify config against current official documentation.
- [x] Document private reporting via the repository security advisories new link, no sensitive public issues; if unavailable, public issue only to request a private channel without vulnerability details. Describe enabling/reporting/settings and hosted CI checks as maintainer release tasks, not completed actions.
- [x] Fetch official verified Neovim v0.11.0 binary in /tmp and run Lua + process integration tests against it using a temporary clone with official pinned Plenary. Record exact runtime versions; do not claim Python3.10 testing if only another version available.
- [x] Run actionlint/zizmor and meaningful config checks; update docs/validation with evidence and unresolved hosted checks. Commit only owned task files and plan. Return report for independent review.

### Task 2: Resolve licensing evidence as far as sources support
**Files:** web/scripts/licenses.mjs, web/scripts/licenses.test.mjs, web/scripts/license-inputs/*, generated dist/ if warranted; docs/licensing-review.md, docs/development.md, docs/validation.md.
**Interfaces:** Existing deterministic notice generator and supplemental-license-evidence.json. Never substitute an arbitrary related repository license for an exact locked artifact.
- [x] Recheck exact npm tarballs, pinned source trees and authoritative upstream history for @reaviz/react-use-fuzzy@1.0.3, create-global-state-hook@0.0.2, defaulty@2.1.0, dotignore@0.1.2, use-composed-ref@1.4.0. Establish whether these modules actually appear in emitted bundle separately from transitive installed metadata.
- [x] Preserve source evidence; use an actual license notice only with demonstrated provenance. Do not fill placeholders from author fields. If sources cannot resolve an ambiguity, document precise evidence and decision needed rather than claim it fixed or contact anyone.
- [x] Clarify embedded ELK worker source availability under EPL-2.0 using existing pinned source references. Add a focused failing generator test for changed output then implement and run license tests.
- [x] Rebuild distribution sequentially, commit source/notices/docs, then verify-dist against HEAD. Update validation and dedicated licensing review with factual outcomes and remaining questions. No dependency changes absent further consultation.
