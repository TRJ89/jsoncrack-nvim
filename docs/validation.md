# Validation record

Date: 2026-10-23 (Asia/Tokyo). This report records the implementation and
validation evidence for the JsonCrack Preview Neovim plugin. Scratch reports
and raw browser traces live outside the repository; the measurements, test
conditions, outcomes, and known limits needed to assess them are reproduced
here.

## Acceptance results

| ID | Result and evidence |
| --- | --- |
| AC01 | **PASS.** The final README entry loaded in isolated LazyVim 16.0.1; its mapping, all three commands, and `:help jsoncrack` resolved. In a real TTY run with Neovim 0.11.6, the actual `<Space>jp` key opened the saved JSON in the isolated OS default Chromium handler, `JsonCrackPreviewOpen` dispatched the same preview URL again, and `JsonCrackPreviewStop` closed the server. The browser showed the graph at opacity 1; Neovim exited 0 and cleanup found no owned processes or listening preview port. Neovim could not resolve `node`, `nodejs`, `npm`, or `npx`. Separately, 6 JSON/YAML/CSP offline E2E cases passed; their Playwright controller used Node as test tooling. |
| AC02 | **PASS.** `web/tests/parse.test.ts`, `web/tests/renderer.spec.ts`, and the JSON E2E case cover objects, arrays, scalar roots, empty containers, visible graph text, and saved updates. |
| AC03 | **PASS.** YAML 1.2 normalization is covered by `web/tests/parse.test.ts`; the YAML case in `web/tests/e2e/preview.spec.ts` verifies rendering and saved updates through the production preview path. |
| AC04 | **PASS.** Parser tests cover malformed/commented JSON, duplicate keys, invalid JSON values, unsupported YAML tags/aliases/multiple documents, and input errors. The renderer keeps the last valid graph and exposes the parse error; the E2E recovery case confirms the next valid save renders. |
| AC05 | **PASS.** The isolated native-default-browser helper changed the target buffer without saving and confirmed the page still showed disk contents; after `:write`, the same tab showed the saved graph and a changed render timestamp. This was exercised with the actual LazyVim key and `vim.ui.open` path. |
| AC06 | **PASS for the measured fixture and environment.** The headed 20-save results below are within the nearest-rank p95 limit of 1,000 ms in both engines. They do not establish the same latency for larger files, background tabs, or physical displays. |
| AC07 | **PASS.** `web/tests/poll.test.ts` checks that a 304 response emits no new snapshot. `web/tests/e2e/preview.spec.ts` verifies unchanged revisions reuse the displayed graph. |
| AC08 | **PASS.** Renderer and app tests cover initial invalid input, preservation of the last valid graph, and recovery. The E2E saved-change case exercises a valid save, an invalid save, and recovery on a later valid save. |
| AC09 | **PASS.** `tests/integration/test_lifecycle.py::test_split_keeps_preview_until_last_view_and_rename_stops_it` checks that a split keeps the preview while the target remains displayed and that losing the last view stops it. Lua session/target tests cover the related buffer state. |
| AC10 | **PASS.** Lua session tests and the integration lifecycle suite cover unload, wipe, rename, and target cleanup. |
| AC11 | **PASS.** The isolated native Firefox check closed the preview tab and used the real `Open` command to reopen it. The README and vimdoc also document `Open` or two `Toggle` presses for a closed tab. |
| AC12 | **PASS.** `web/tests/e2e/preview.spec.ts::reopens a closed browser tab with the same preview process` verifies the same process serves a reopened page. The saved-change case also exercises a page reload without starting another preview process. |
| AC13 | **PASS.** `tests/lua/commands_spec.lua`, `tests/lua/session_spec.lua`, and `tests/lua/process_spec.lua` cover repeated start/stop requests, command state, stale callbacks, and owned-process cleanup. |
| AC14 | **PASS.** `tests/integration/test_lifecycle.py` runs 20 start/stop cycles and checks listener/child cleanup after normal and SIGKILL Neovim exit within two seconds. All 8 lifecycle tests passed on Python 3.14.4 and 3.10.18. |
| AC15 | **PASS.** Lifecycle and process tests cover missing Python/assets and startup failure cleanup; Lua process/command tests exercise browser-launch failure reporting and ensure the spawned process is reaped. |
| AC16 | **PASS.** `web/tests/e2e/preview.spec.ts::keeps separate Neovim sessions isolated after Stop` confirms independent sessions use separate preview endpoints and stopping one does not affect the other. |
| AC17 | **PASS.** Python snapshot tests and the E2E limit case reject input over 1 MiB; parser tests reject nesting beyond depth 100, unsafe integers, and non-finite values. The E2E limit case confirms Neovim remains responsive. |
| AC18 | **PASS.** The renderer and app tests distinguish the 1,500-node limit from parse errors; the E2E limit case saves an oversized graph and then a small graph to confirm recovery. |
| AC19 | **PASS.** Python snapshot tests cover deletion, unreadable files, atomic replacement, symlink and parent replacement, and safe recovery. The browser E2E case verifies read failure and recovery after atomic replacement. |
| AC20 | **PASS.** `tests/python/test_http.py` checks missing/incorrect tokens, authentication before ETag and target reads, invalid/nonlocal Host and Origin, path/query rejection, and absence of CORS permission. |
| AC21 | **PASS.** HTTP and snapshot tests cover traversal, symlink/FIFO replacement, path races, slow-connection limits, and recovery without unbounded handler growth. |
| AC22 | **PASS.** Renderer and E2E tests pass hostile HTML/script-like values as text; the E2E case asserts CSP and that no script execution or external request occurs. |
| AC23 | **PASS.** The 6-case offline E2E run executed inside a `bwrap --unshare-net` network namespace with loopback available and no external route. It covered JSON saved updates, YAML saved updates, and CSP/no-external-request checks in Chromium and Firefox. The test's browser request observer also confirmed no external page requests. |
| AC24 | **PASS.** Poller tests stop immediately on authorization failure, ignore responses arriving after stop, and enforce the reconnect deadline. App tests show the stopped connection and reconnect path; the E2E Stop case confirms a stopped tab cannot reconnect to a later session. |
| AC25 | **PASS locally.** The offline license generator, generated distribution, README, project MIT license, third-party notices, and push/PR workflow passed the final clean-checkout validation below. No GitHub-hosted Actions run was performed for this local branch, and CI does not publish artifacts. |

## Commands and suite evidence

The distribution regression suite was developed against a valid temporary
control distribution and checks missing manifest targets, unmanifested assets,
source maps, missing referenced license text, and changed/new/missing tracked
files. It runs the checker from a temporary non-repository working directory;
all 9 cases passed:

```text
python3 -m unittest discover -s tests/python -p 'test_distribution.py' -v
Ran 9 tests ... OK
```

Focused license-generator tests passed 2/2 with `node --test
web/scripts/licenses.test.mjs`. The generator also completed an offline build
from the checked-in npm lockfile and bundled license inputs. Its output passed
`python3 scripts/check_dist.py`: 5 manifested assets, 200 runtime package
instances, and 110 license text files. The `dist/` tree contains 119 regular
files totaling 4,198,586 bytes (uncompressed file sizes).

Before committing, each distribution negative assertion was mutation-tested:
when the corresponding validation guard was bypassed in a disposable checker
copy, its test failed because invalid input was accepted. The valid-control
case passed with the unmodified checker. Temporary distribution mutations were
confined to test directories; the checked-in `dist/` was not used as a
mutation fixture.

### Final clean-checkout `make check`

Commit `3a484fe5d3bfb56bfd6b26d06309c490093fc179` was checked in a new
detached checkout with the pinned Plenary revision as a sibling and a fresh
`npm ci --offline` installation from the checked-in lockfile. The environment
was Neovim 0.11.6, Python 3.14.4, Node 22.19.0/npm 10.9.3, Stylua 2.6.0,
Selene 0.32.0, Playwright 1.64.1, Chromium 156.0.8078.4, Firefox 157.0, and
Plenary commit `74b06c6c75e4eeb3108ec01852001636d85a932b`. `make check`
ran from `/tmp/jsoncrack-task8-cleancheck/jsoncrack-nvim` with exit code 0:

```sh
cd /tmp/jsoncrack-task8-cleancheck/jsoncrack-nvim
PATH=/tmp/jsoncrack-tools/bin:/home/zy/.nvm/versions/node/v22.19.0/bin:$PATH \
  NVIM_LOG_FILE=/tmp/jsoncrack-task8-finalcheck.nvim.log make check
```

The Plenary checkout was at `../plenary.nvim`; web dependencies were installed
in `web/` with `npm ci --offline` before running this command. Results:

| Check | Result |
| --- | --- |
| Stylua / Selene | pass; 0 errors, 0 warnings, 0 parse errors |
| TypeScript typecheck / Python compileall | pass |
| Python unit tests | 52 passed |
| Lua / Plenary | 25 passed (target 4, session 11, commands 3, process 7) |
| Vitest | 63 passed in 5 files |
| License generator unit tests | 2 passed |
| Renderer Playwright | 24 passed (12 each in Chromium and Firefox) |
| Process integration | 8 passed |
| Preview E2E | 14 passed (7 each in Chromium and Firefox) |
| Build and distribution inventory | pass; 5 manifested assets, 200 runtime package instances, 110 license texts |

The test suites contain 188 passing cases in total, excluding the separate
20-sample-per-browser performance run. The final generated `dist/` remained
byte-for-byte equal to the committed inventory and contained 119 files
totaling 4,198,586 bytes. The clean checkout had no tracked or untracked
changes after the check.

An initial attempt reused `node_modules` through a symlink to another checkout;
Vite resolved Reaflow to that checkout and the renderer adapter correctly
refused to build. That run was discarded as an invalid fresh-checkout setup.
After replacing the symlink with `npm ci --offline` in the new checkout, the
complete `make check` passed. No product code change was made for that setup
diagnostic.

## Final review follow-up

Commit `2628e27dfd9aa39f1c0887fc47c43b5a05edd9bb` clarifies that
`:JsonCrackPreviewOpen` asks the user to stop a preview on another target, and
formats the upstream README fragment `MIT ©` as quoted evidence in the generated
notices. The project license and all 110 copied `dist/licenses/` text files
remain byte-for-byte unchanged. The generated `dist/` currently contains 119
regular files totaling 4,198,588 bytes; the 4,198,586-byte inventory above
continues to describe the earlier clean-checkout check at commit
`3a484fe5d3bfb56bfd6b26d06309c490093fc179`.

Focused checks for this documentation and notice-format change passed:
`node --test web/scripts/licenses.test.mjs` passed 2/2, and
`python3 -m unittest discover -s tests/python -p 'test_distribution.py' -v`
passed 9/9. `make build` followed by `python3 scripts/check_dist.py` reported
5 manifested assets, 200 runtime package instances, and 110 license texts.
After commit `2628e27`, `make verify-dist` rebuilt the distribution and passed
`python3 scripts/check_dist.py --check-tracked` with the same inventory. The
build completed with Vite's advisory that some chunks exceed 500 kB after
minification.

No runtime code changed in this follow-up, so the 188-case runtime suite,
native-browser checks, and performance measurements were not rerun; their
results above remain tied to the commits and environments already recorded.

## Runtime closure and attribution

The build and plugin runtime are offline. The generator walks the required and
optional production dependency closure in `web/package-lock.json`, excluding
development dependencies, and copies each applicable installed license or
notice text byte-for-byte into a SHA-256-addressed file. The generated JSON
records the package version, lockfile path, resolved source URL, integrity, and
license expression; the Markdown notice is intended for readers. Build fails
when a locked runtime package has no recognized license text unless it has a
pinned, reviewed supplement.

Five packages in the locked runtime closure declare MIT but ship without a
standalone license file: `@reaviz/react-use-fuzzy@1.0.3`,
`create-global-state-hook@0.0.2`, `defaulty@2.1.0`, `dotignore@0.1.2`, and
`use-composed-ref@1.4.0`. Their package declarations and pinned repository
source evidence are recorded in
[`web/scripts/license-inputs/supplemental-license-evidence.json`](../web/scripts/license-inputs/supplemental-license-evidence.json).
The shared MIT terms come from SPDX License List v3.29.0 at commit
`31ba1a50e5397e00a304dbadc76531740e89ee48`; they are explicitly labeled a
canonical supplement, not text copied from those package archives. Known
package authors are included only where pinned metadata or README text names
them; no copyright year or holder is invented.

Reaflow 5.4.1 embeds an ELK worker from `elkjs` 0.10.0, while the current
installed dependency is `elkjs` 0.10.2. The worker payload is preserved
unchanged and matched to the pinned `elkjs` 0.10.0 source (`lib/elk-worker.min.js`)
by SHA-256 `cda1839e26f82a7ac142692ee813974f8f359987348d21d1f16af8f86ff96e80`
and Git blob SHA-1 `aefee8891cabdaf247410197304c1e4bee3cdb14`. The generated
asset comment identifies both Reaflow's Apache-2.0 terms and the embedded
worker's EPL-2.0 terms. The exact EPL text and pinned `elkjs`/Eclipse ELK
source references are carried in the repository license inputs and generated
notices; the notice does not misidentify the installed 0.10.2 package as the
worker source.

The plugin's own code is under the project MIT license in [`LICENSE`](../LICENSE).
Third-party texts remain separate in `dist/licenses/` and are summarized by
[`dist/THIRD-PARTY-NOTICES.md`](../dist/THIRD-PARTY-NOTICES.md) and
[`dist/THIRD-PARTY-NOTICES.json`](../dist/THIRD-PARTY-NOTICES.json).

## Browser and performance evidence

### Isolated operating-system default browser

The native-browser checks used an isolated XDG configuration with disposable
Firefox and Chromium handlers. The actual LazyVim 16.0.1 mapping called
`vim.ui.open`; neither `vim.ui.open` nor browser selection was mocked. The
four cases were checked at product commit `2983880` (the following
`6e4f9d1` commit changes only the lifecycle test deadline). Firefox 158.0.1
and Chromium 156.0.8078.4 both rendered JSON and YAML, received a save
from Neovim, displayed the new graph text and timestamp, and had no error
overlay. Firefox's JSON case also exercised closing the browser tab and
reopening it with the real `Open` command. Browser profiles and default-handler
configuration were isolated in temporary directories; the user's defaults and
profiles were not changed. The screenshots and DOM traces are temporary
validation evidence, while the outcomes and exact versions are recorded here.

For the README smoke, an isolated LazyVim 16.0.1 config loaded the example
with only `dir` changed to the candidate checkout path as the README instructs.
The mapping, all three commands, and `:help jsoncrack` resolved. A real TTY run
then fed the configured `<Space>jp` key while a saved JSON file was the current
buffer. This focused no-Node smoke ran at Task 8 commit
`3a484fe5d3bfb56bfd6b26d06309c490093fc179`. Neovim 0.11.6 used the actual,
unmocked `vim.ui.open` path and isolated OS handler to
launch Chromium 156.0.8078.4; the page showed the saved buffer name, graph
marker, connected status, and opacity 1. The real `JsonCrackPreviewOpen`
command then dispatched the same preview URL to the default handler again.
`JsonCrackPreviewStop` closed the port, Neovim exited with code 0, and cleanup
found no preview listener or owned process. The runtime PATH contained Python
3.10.18 and isolated `xdg-open`/`kde-open` handlers but no executable for
`node`, `nodejs`, `npm`, or `npx`; both the external command lookup and
Neovim's executable lookup confirmed their absence. LazyVim was 16.0.1 at
commit `999700997f72227187d49d8b92667183dc7fc809`. The helper checked process
exit and cleanup before shutting down its browser observer.

### Offline runtime check

The plugin runtime was launched with a PATH containing only a test-owned
Python 3.10.18 executable. The test-owned `nvim` wrapper checked
`command -v node nodejs npm npx` and failed if any tool resolved; it then
executed the system Neovim binary with the Python-only PATH inherited by the
plugin processes. The Playwright driver and browser binaries remained test
tools, not plugin runtime requirements. The test ran in `bwrap
--unshare-net`; inside that network namespace the only interface was loopback,
used by the local server, with no external route. The page test also recorded
and rejected external browser requests. To reproduce after installing the
locked web dependencies and browser engines, create `PYTHON_ONLY_BIN` with a
`python3` symlink to Python 3.10.18, place the wrapper named `nvim` first on
the test driver's PATH, and have that wrapper verify the four commands above
are absent before `exec`-ing Neovim by absolute path. Then run this command
inside the isolated namespace, with the test wrapper directory before the
Playwright/Node paths in `PATH`:

```sh
bwrap --unshare-net --ro-bind / / --bind "$WORKTREE" "$WORKTREE" \
  --bind "$TEST_TMP" /tmp --proc /proc --dev /dev \
  --chdir "$WORKTREE" --setenv PATH "$NVIM_WRAPPER_BIN:$TEST_TOOLS_BIN:$NODE_BIN:$SYSTEM_PATH" \
  --unsetenv NVIM_BIN -- /bin/sh -c \
  'node web/node_modules/@playwright/test/cli.js test --config web/playwright.config.ts web/tests/e2e/preview.spec.ts --project=chromium --project=firefox --grep "renders saved changes|renders YAML updates|applies CSP"'
```

Three selected E2E cases (saved JSON/update and recovery, saved YAML update,
and CSP/hostile data/no external page requests), each in Chromium and Firefox,
passed 6/6. This establishes the plugin's local runtime path for those tested
flows; it is not a claim that the build/test harness itself runs without Node.

### Performance method and results

The measurement starts when Neovim's `:write` finishes and stops when the
changed render marker, matching graph text with visible bounds, and computed
opacity 1 are stable across two foreground animation frames. The driver
aligns the browser and Node clocks using the lowest-round-trip of five
samples; Neovim timestamps the write completion with `vim.uv.hrtime()`. Save
RPC acknowledgement and Playwright readback overhead are measured separately.
The p95 is the nearest-rank 19th sorted sample of 20 sequential headed saves.
The fixture is `tests/fixtures/preview.json`: 7,111 bytes, 262 JSON values,
67 rendered graph nodes, and 267 SVG groups. The acceptance thresholds are
100 KiB input, 300 rendered nodes, and p95 <= 1,000 ms.

| Engine | Browser/version | Samples | p95 | Result |
| --- | --- | ---: | ---: | --- |
| Chromium | Playwright Chromium 156.0.8078.4, X11 | 20 | 526.674 ms | PASS |
| Firefox | Playwright Firefox 157.0, X11 | 20 | 911.385 ms | PASS |

The measurements ran on Linux `7.0.0-38-generic` x64 with an AMD Ryzen 7 1700
(16 logical cores), 32 GiB RAM, Neovim 0.11.6, Python 3.14.4, and Node
22.19.0. The browser window was foreground and focused on a test-owned Xvfb
screen `:93`, 1280 x 900 x 24, with Openbox and an approximately 60 Hz
animation-frame cadence. Wayland was unset; `XDG_RUNTIME_DIR` was
`/run/user/1000`. This is a virtual display measurement, not a physical
monitor measurement. The source reports contain per-sample timing precision;
the complete rounded save-to-visible-render values are reproduced below in
sample order (milliseconds):

| Save | Chromium | Firefox |
| ---: | ---: | ---: |
| 1 | 833.018 | 920.252 |
| 2 | 406.586 | 895.194 |
| 3 | 446.000 | 441.025 |
| 4 | 470.535 | 453.199 |
| 5 | 468.422 | 468.640 |
| 6 | 416.160 | 459.061 |
| 7 | 449.676 | 589.160 |
| 8 | 465.057 | 911.385 |
| 9 | 489.594 | 416.467 |
| 10 | 454.078 | 452.076 |
| 11 | 474.106 | 486.164 |
| 12 | 425.058 | 453.316 |
| 13 | 466.480 | 464.641 |
| 14 | 443.205 | 472.265 |
| 15 | 508.637 | 477.057 |
| 16 | 526.674 | 512.072 |
| 17 | 437.541 | 608.840 |
| 18 | 423.187 | 863.573 |
| 19 | 455.681 | 405.057 |
| 20 | 475.571 | 466.055 |

The production Vite build reports that some minified chunks exceed 500 kB.
This is the known ELK/graph-layout bundle; its payload was not changed just to
silence the warning. It is also why the check records byte size and bundle
warning instead of claiming a small download.

Vitest prints the expected `Simulated renderer failure` console error while
testing recovery from a renderer exception; the test passes and verifies the
error boundary resets for the next input.

## CI and release boundary

`.github/workflows/ci.yml` checks the full suite on Linux with Neovim 0.11.6,
Python 3.10, Node 22.23.4, npm 10.9.9, Stylua 2.6.0, Selene 0.32.0,
pinned Plenary, and Playwright Chromium/Firefox. A compatibility matrix runs
Neovim stable and nightly with Python 3.10 and the current Python 3.x line;
nightly is advisory. The plugin and Plenary check out as sibling directories
inside the GitHub workspace. Workflow permissions are read-only, and there is
no publishing job. The workflow file was reviewed locally but no remote
GitHub Actions run has been made for this checkout. There is no configured
public repository URL or package coordinate, so public installation and
release remain unpublished.

## Main integration and publication review — 2026-10-24

The MVP branch was fast-forward merged into `main` at `e954f5f`. In the
main checkout, `make test` completed with exit code 0: Python 52, Lua 25,
Vitest 63, license generator 2, renderer 24, lifecycle integration 8, and
preview E2E 14 (188 total). TypeScript typecheck and `make verify-dist`
also passed; the generated distribution matched the committed files.

An earlier test attempt overlapped a normal distribution rebuild and failed
one lifecycle case while waiting for a Python child. The build empties
`dist/` before regenerating it, so that overlapping run was not treated as
valid merged-checkout evidence. The complete test suite passed when rerun
after the build had finished. No runtime code changed for this rerun.

The npm advisory query (`npm --prefix web audit --json`) returned zero
known vulnerabilities on this date. Installation still reported deprecated
packages, including `inflight`, `whatwg-encoding`, `coverup`, `glob`, and
`react-use-gesture`; those are maintenance considerations, not a claim of
complete dependency security. A limited scan of tracked files found no
private-key headers, common GitHub token patterns, AWS access-key IDs,
tracked environment files, or tracked dependency/scratch directories.
This scan is not an exhaustive security audit.

A public remote has not been configured. Before a public release, select
the repository URL, add the corresponding remote-install example to the
README, and confirm the hosted GitHub Actions results. The hosted CI matrix
remains unexecuted here. No push, public repository creation, or release
publication was performed during this review.

## Release preparation toolchain and documentation — 2026-10-24

The development pins are Node.js 22.23.4 and npm 10.9.9 in `.node-version`,
`web/package.json`, the lockfile root engines, and the full-check CI job. Node
and npm are development tools; the plugin runtime still uses no Node.js or
npm. The historical 2026-10-23 clean-checkout and performance records above
retain their original Node 22.19.0/npm 10.9.3 values and `<Space>jp` evidence.

From `web/`, `node --version` printed `v22.23.4`, `npm --version` printed
`10.9.9`, and `npm ci` exited 0, adding 316 packages. It reported the existing
deprecations for `inflight`, `coverup`, `whatwg-encoding`, `glob`, and
`react-use-gesture`. The lockfile diff changes only the root `engines` values;
dependency versions, resolved URLs, integrity hashes, and license text were
not changed.

The first sandboxed `make check` exited 2 because test server subprocesses
could not bind their local `127.0.0.1` sockets. The Python tests consequently
reported 17 failures and 2 errors with `START_FAILED`; a direct diagnostic
traced that response to `create_server` raising `loopback HTTP server could
not start`. The same command was then rerun with local loopback access enabled
and exited 0. No product code changed for the sandbox restriction.

The passing run used Node.js 22.23.4/npm 10.9.9, Neovim 0.11.6, Python 3.14.4,
Stylua 2.6.0, Selene 0.32.0, Playwright 1.64.1, Chromium, Firefox, and the
sibling Plenary checkout. Stylua and Selene reported 0 errors, 0 warnings,
and 0 parse errors; TypeScript typecheck and Python compileall passed. The
suite results were:

| Check | Result |
| --- | --- |
| Python unit tests | 52 passed |
| Lua / Plenary | 25 passed |
| Vitest | 63 passed in 5 files |
| License generator tests | 2 passed |
| Renderer Playwright | 24 passed, 12 per browser |
| Process integration | 8 passed |
| Preview E2E | 14 passed, 7 per browser |
| Total | 188 passed |
| Distribution validation | 5 manifested assets, 200 runtime package instances, 110 license texts; `make verify-dist` passed |

The rebuild left `dist/` unchanged and its tracked inventory matched. The
expected Vite warning about chunks larger than 500 kB appeared during renderer
tests and the final build. Vitest also printed its expected simulated renderer
failure while testing error-boundary recovery; the test passed. The npm
installation emitted the deprecation notices listed above.

The previous CI Selene step used `cargo install --locked --version 0.32.0`,
which could not find that exact version in the configured crate registry
(local search returned 0.31.0). CI now downloads the official Selene 0.32.0
Linux release archive and checks SHA-256
`d3773393578580074386e69337d35b7acddfbaa9fc38964c07fa3e28436ade9b` before
extracting it. The archive does not retain its executable bit, so the step
applies `chmod +x` before checking the binary. I executed the changed shell
step with disposable `RUNNER_TEMP` and `GITHUB_PATH` values using the cached
release archive as a local file URL: checksum verification passed and the
installed binary reported `selene 0.32.0`. The hosted GitHub Actions download
and full CI run remain unverified.

For the current README mapping smoke, an isolated headless Neovim 0.11.6
configuration loaded the README plugin spec through cached lazy.nvim commit
`85c7ff3`, with only `dir` changed to this checkout. Feeding `<Space>cj` (the
configured `<leader>cj`) invoked `JsonCrackPreviewToggle` and the stubbed
`vim.ui.open` captured the preview URL. `:help jsoncrack` resolved to
`doc/jsoncrack.txt`. This smoke verified mapping dispatch and help lookup; it
did not display a browser window. The host lacks a vimdoc Treesitter parser,
so the help check skipped filetype autocommands. Earlier visible-browser
evidence in this document used the prior historical `<Space>jp` mapping.

## Python type checking — 2026-10-31

The pre-change Pyright 1.1.407 run over `server scripts tests` reported 65
errors, 0 warnings, and 0 informations. The newly configured project check
reported the same 65 diagnostics before the Python fixes. After the fixes,
`npm --prefix web run typecheck:python` reports 0 errors, 0 warnings, and 0
informations. `make lint-python` runs Python `compileall` and this pinned
project check. A temporary owned test fixture with an intentional `str` to
`int` mismatch made `make lint-python` fail with one Pyright assignment error;
the fixture was removed, and the clean target passed.

The final sequential `make check` exited 0 with Node.js 22.23.4/npm 10.9.9,
Python 3.14.4 on Linux, Neovim 0.11.6, Stylua 2.6.0, Selene 0.32.0, and
Playwright 1.64.1 with Chromium and Firefox. Pyright targets Python 3.10;
the runtime floor remains Python 3.10, while the available local interpreter
was 3.14.4. The suite reported:

| Check | Result |
| --- | --- |
| Stylua / Selene | 0 errors, 0 warnings, 0 parse errors |
| Web TypeScript / Python compileall / Pyright | Passed; Pyright 0/0/0 |
| Python unit tests | 52 passed |
| Lua / Plenary | 25 passed |
| Vitest | 63 passed in 5 files |
| License generator tests | 2 passed |
| Renderer Playwright | 24 passed, 12 per browser |
| Process integration | 8 passed |
| Preview E2E | 14 passed, 7 per browser |
| Distribution validation | 5 manifested assets, 200 runtime package instances, 110 license texts |
| Total tests | 188 passed |

The build emitted its existing Vite warning about chunks larger than 500 kB.
Vitest printed the simulated renderer error used by its passing error-boundary
tests. `npm ci` installed the exact lockfile and reported 4 moderate audit
findings in the existing dependency tree, including the existing
`minimatch@3.1.5` path through `glob`/`dotignore`/`tape`; no unrelated
dependencies were changed. The earlier install command reported 7 moderate
findings before the clean install's audit report. The full GitHub Actions run
was not executed locally.

Two earlier full-suite launcher attempts were excluded from these results:
the first lost session tracking and overlapped a second invocation, and the
second encountered the first run's port 4173 listener. I inspected the
process tree and waited for both the prior processes and listener to exit
before running the single final check recorded above. Those orchestration
attempts are not treated as test results.

## Bilingual documentation verification — 2026-11-01

The English and Japanese READMEs now use matching `lazy.nvim` specs with the
planned `TRJ89/jsoncrack-nvim` identifier, three commands, and the optional
`<leader>cj` mapping. The remote spec is explicitly marked unavailable until
publication; local-checkout loading and contributor commands are in
`docs/development.md`. The full parser contract and measured performance
summary are in `docs/input-support.md`, with links from both READMEs.

Focused checks passed: an offline link scan resolved all 21 local Markdown
links in the user docs; Neovim 0.11.6 parsed all three Lua examples, and the
English/Japanese remote specs matched apart from the localized key description.
The existing Mason Pyright executable at
`/home/zy/.local/share/nvim/mason/bin/pyright --project pyrightconfig.json`
also exited 0 with 0 errors, warnings, or informations.

An isolated configuration loaded the English README spec through cached
lazy.nvim commit `85c7ff3`, replacing only the planned repository identifier
with the checkout's local `dir`. Feeding `<Space>cj` loaded the plugin, started
the real local preview server, and captured its loopback URL through a stubbed
`vim.ui.open`; the actual Stop command stopped it. A copied help file received
tags in the temporary runtime and `:help jsoncrack` resolved with autocommands
disabled. This headless smoke did not open a browser window or verify browser
rendering. The initial smoke harness disabled lazy.nvim startup and then used
queued input instead of immediate key execution; the corrected harness used
`nvim_feedkeys(..., "xt", false)` and passed. No product change or full-suite
rerun was needed for these documentation edits.

## npm advisory assessment — 2026-11-01

A fresh `npm audit` reports seven moderate findings, all for
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), through
`jsoncrack-react > reaflow > ellipsize@0.2.0 > tape > glob/dotignore >
minimatch@3.1.5`. The advisory concerns attacker-controlled glob patterns when
`optimizationLevel >= 2` is used by `firstPhasePreProcess` or
`secondPhasePreProcess`. The installed `minimatch@3.1.5` does not contain those
functions. `ellipsize`'s runtime entry point does not import `tape`, and this
project's tests use Vitest and `node:test`, not `tape`.

An in-memory Vite production build (`write: false`) enumerated 557 modules and
included none from `minimatch`, `glob`, `dotignore`, or `tape`. Its six
generated files were byte-identical to the current `dist/`. Based on these
checks, exposure through the current build is low. Accept this targeted
advisory for the current lockfile and bundle, and reassess after dependency
updates. This is not a blanket audit exception or a claim that all
dependencies are vulnerability-free.

## Node details — 2026-11-03

The node-local resolver and dialog were developed with focused Vitest checks
against the pinned `jsoncrack-react@1.0.5` parser. RED runs of
`npm --prefix web run test -- tests/nodeDetails.test.ts` first failed all 6
resolver expectations. As coverage expanded, 3 of 8 tests failed for direct
object values, container-only objects, and valid root `null`; a later
special-key case also failed (1 of 9) until the projection preserved
`__proto__`. The initial dialog test run could not load the not-yet-created
component. GREEN evidence includes 9/9 resolver tests, 9/9 dialog tests, and
84/84 tests across all 7 Vitest files. The RED/GREEN commands and counts are
reproduced here so the evidence does not depend on local scratch logs.

The first sequential `PATH=/home/zy/.nvm/versions/node/v22.23.4/bin:/tmp/jsoncrack-node-details-tools:$PATH make check`
exited 2 at Preview E2E. Its preceding checks passed: Stylua/Selene,
TypeScript, Python compileall and Pyright; 52 Python tests; 25 Lua tests; 84
Vitest tests; 2 license tests; 28 renderer tests (14 per browser); and 8
process-integration tests. The four E2E failures were the two new browser
interactions targeting the pinned renderer's non-clickable `foreignObject`,
plus the preview serving the previous committed `dist` bundle before the new
feature had been built. After changing those interactions to click the real
SVG node rectangle and rebuilding `dist`, focused Chromium E2E passed 2/2 and
`make test-e2e` passed 14/14 (7 Chromium, 7 Firefox). The hostile-data dialog
assertion checks the exact JSON-escaped text; the test also found no injected
markup or external requests. After committing the regenerated bundle,
`make verify-dist` passed and reported 5 manifested assets, 200 runtime
package instances, and 110 license texts. The build emitted the existing
Vite large-chunk warning.

The 682 x 340 open-dialog screenshot was captured and visually inspected.
Object node details show direct scalar properties and empty containers, omit non-empty child
containers already represented by separate graph nodes, and explain that
omission. Array nodes show their actual complete array value. These rules,
including nested-array path recovery for the pinned parser's empty `path`, are
also documented in the READMEs and vimdoc.

## Node details copy feedback fix — 2026-11-03

The focused overlap regression test first failed as expected: after path and
content copies were started before either clipboard promise settled, content
failure feedback appeared but the successful path copy feedback was omitted
(10 tests passed, 1 failed). After moving request generations to per-field
counters while invalidating both fields on close, unmount, and details change,
`PATH=/home/zy/.nvm/versions/node/v22.23.4/bin:$PATH npm --prefix web run test -- tests/NodeDetailsDialog.test.tsx`
passed all 11 dialog tests. The same pinned Node PATH with
`npm --prefix web run typecheck` exited 0. `PATH=/home/zy/.nvm/versions/node/v22.23.4/bin:$PATH make build`
exited 0 and regenerated `dist`; Vite printed its existing warning about
chunks larger than 500 kB. Post-commit
`PATH=/home/zy/.nvm/versions/node/v22.23.4/bin:$PATH make verify-dist` passed;
the tracked rebuild matched `dist` and reported 5 manifested assets, 200
runtime package instances, and 110 license texts.

## Node details review and merge verification — 2026-11-03

Review identified a long JSON Path that could push content and copy controls
out of the bounded dialog. The path now has its own bounded, keyboard-focusable
scroll region. The narrow 360 x 500 viewport regression
(`npm --prefix web run test:renderer -- --grep='long path scrollable'`)
failed before the fix and passed in Chromium and Firefox afterward (2/2).
It checks full path text, scrolling, selection, content, and visible copy
controls using a real node click. A long-key shallow fixture isolates this
layout condition; this test does not claim maximum-depth graph navigation
coverage. The narrow screenshot was also visually inspected. Typecheck and
post-commit distribution verification passed for this fix.

Independent task review, the scoped layout re-review, final branch review,
and the clipboard fix re-review completed with no unresolved findings. After
fast-forward integration into main, `npm --prefix web run test` passed all
85 tests in 7 files, and `python3 scripts/check_dist.py --check-tracked`
confirmed 5 manifested assets, 200 runtime package instances, and 110 license
texts. Earlier full-suite sections and the later focused checks are recorded
above; no claim is made that the final changes received a second complete
`make check` run.

## Node details readability — 2026-11-03

`web/src/JsonContent.tsx` renders syntax-colored spans using the original JSON
characters as React text. Focused dialog tests cover escaped quotes, literals,
numbers, markup-like strings, exact reconstructed text, selection, and keyboard
focus behavior. The final `npm --prefix web test` run passed 86 tests in 7
files, and `npm --prefix web run typecheck` exited 0.

The full renderer suite passed 32 tests (16 per browser) before the final
scrollbar and short-landscape spacing refinements. After those refinements, the
focused command
`npm --prefix web run test:renderer -- --grep='long path scrollable|long Japanese JSON'`
passed all 4 Chromium/Firefox cases. It exercises actual horizontal and
vertical scrolling, PageDown, large desktop dimensions, and visible controls
at 360 x 500 and 844 x 390. At 844 x 390, the long path, omission note, copy
feedback, and copy controls remain visible while the JSON viewport remains at
least 80 px high.

Full-page screenshots with the long Japanese fixture are saved outside the
repository at `/tmp/jsoncrack-readability-{chromium,firefox}-{desktop,narrow}.png`;
the corresponding short-landscape screenshots are also in `/tmp`. The final
Chromium desktop and narrow images were recaptured with Playwright's headless
`--hide-scrollbars` default disabled and the pointer over the JSON viewport's
scrollbar, so the styled track and thumb are visible. The regular Playwright
headless screenshot path hides scrollbars by default; this setting affects the
capture only, not the UI implementation.

After `PATH=/home/zy/.nvm/versions/node/v22.23.4/bin:$PATH make build`
regenerated the tracked production `dist/`, `make test-e2e` passed all 14
preview tests (7 per browser) against that distribution. This includes the
hostile-data and CSP checks. The build reported the existing Vite advisory
about chunks larger than 500 kB.

After committing the regenerated assets, `PATH=/home/zy/.nvm/versions/node/v22.23.4/bin:$PATH make verify-dist`
rebuilt them and passed `python3 scripts/check_dist.py --check-tracked` with
5 manifested assets, 200 runtime package instances, and 110 license texts.

The independent task review and final branch review found no actionable
defects. After fast-forward integration into main, the complete web unit suite
passed again (86/86), and the tracked distribution check passed with the same
asset/package/license counts. No backend changes were made or backend suite
rerun for this presentation-only refinement.
