# Validation record

Date: 2026-10-23 (Asia/Tokyo). This report records the implementation and
validation evidence for the JsonCrack Preview Neovim plugin. Scratch reports
and raw browser traces live outside the repository; the measurements, test
conditions, outcomes, and known limits needed to assess them are reproduced
here.

## Acceptance results

| ID | Result and evidence |
| --- | --- |
| AC01 | **PENDING focused LazyVim TTY verification.** The final README entry loaded, and the configured key, all three commands, and `:help jsoncrack` resolved in the isolated smoke. The helper is rerunning the actual key/Open/Stop assertions with its Python-only PATH and will add a result after clean exit is confirmed. Separately, the offline runtime run verified that Neovim could not resolve `node`, `nodejs`, `npm`, or `npx`; 6 JSON/YAML/CSP E2E cases passed. The Playwright controller itself used Node to drive that test. |
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
| AC25 | **PENDING final clean-checkout `make check`.** The offline license generator, generated distribution, README, project MIT license, third-party notices, and push/PR workflow are in place. No GitHub-hosted Actions run was performed for this local branch, and CI does not publish artifacts. |

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

A full fresh-checkout `make check` result, including current aggregate test
counts and the tested Task 8 commit, will be added to the final verification
note after that run.

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
The mapping, all three commands, and `:help jsoncrack` resolved. A focused
TTY run is checking actual key/Open/Stop behavior with the Python-only Neovim
PATH; its result is pending clean exit confirmation and will be added as a
docs-only follow-up when received.

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

## CI and release boundary

`.github/workflows/ci.yml` checks the full suite on Linux with Neovim 0.11.6,
Python 3.10, Node 22.19.0, npm 10.9.3, Stylua 2.6.0, Selene 0.32.0,
pinned Plenary, and Playwright Chromium/Firefox. A compatibility matrix runs
Neovim stable and nightly with Python 3.10 and the current Python 3.x line;
nightly is advisory. The plugin and Plenary check out as sibling directories
inside the GitHub workspace. Workflow permissions are read-only, and there is
no publishing job. The workflow file was reviewed locally but no remote
GitHub Actions run has been made for this checkout. There is no configured
public repository URL or package coordinate, so public installation and
release remain unpublished.
