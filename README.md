# JsonCrack Preview for Neovim

JsonCrack Preview opens the saved contents of one JSON or YAML buffer in the official JSON Crack graph view in your operating system's default browser. Saving the target file updates the page automatically. The plugin and its browser assets run locally.

This MVP supports Linux desktop sessions with LazyVim. It uses the bundled
`dist/` files, a small Python 3 server, and `vim.ui.open`; using the plugin does
not require Node.js, npm, pip, a network connection, or an install-time build.

## Requirements

- Neovim 0.11 or newer.
- Python 3.10 or newer available as `python3`.
- A Linux desktop with a configured default browser and a working `vim.ui.open` implementation.
- LazyVim with `lazy.nvim`, or another setup that loads this plugin's `plugin/jsoncrack.lua`.

The supported preview target is a saved, readable regular file named with `.json`, `.yaml`, or `.yml`. JSONC and other file types are not supported. Headless Neovim, SSH sessions, multiple simultaneous previews in one Neovim process, following a renamed buffer, and automatic preview closure when a browser tab closes are outside the MVP scope.

## Install from a local checkout

Add the following file to your LazyVim config, for example
`~/.config/nvim/lua/plugins/jsoncrack.lua`. The example assumes this checkout
is at `~/projects/jsoncrack-nvim`; if yours is elsewhere, replace that
directory with your checkout location:

```lua
return {
  {
    dir = vim.fn.expand("~/projects/jsoncrack-nvim"),
    name = "jsoncrack.nvim",
    cmd = {
      "JsonCrackPreviewToggle",
      "JsonCrackPreviewOpen",
      "JsonCrackPreviewStop",
    },
    keys = {
      {
        "<leader>jp",
        "<cmd>JsonCrackPreviewToggle<cr>",
        desc = "Toggle JSON Crack preview",
      },
    },
  },
}
```

There is no `setup()` call, `build` hook, or install-time download. The source
checkout already contains the browser assets. Change only `dir` when using a
different checkout location.

## Use

Open a saved JSON or YAML file and press `<leader>jp`, or run one of the three
commands:

- `:JsonCrackPreviewToggle` starts a preview for the current buffer. If a
  preview is already running, it stops that session regardless of the current
  buffer.
- `:JsonCrackPreviewOpen` starts a preview when none is running. For the same
  target, it asks the default browser to open the existing preview URL again;
  if another target is active, it asks you to stop that preview first. The
  operating system may open a new tab; existing-tab reuse is not promised.
- `:JsonCrackPreviewStop` stops the server and leaves any browser tab open.
  That tab will show that it can no longer reconnect.

The preview reads the file from disk. If the buffer has unsaved edits, the
plugin warns that those edits are excluded. Save with `:write`; the browser
polls the saved file every 500 ms and updates without a manual reload. A new,
unnamed, unreadable, or unsupported buffer cannot start a preview.

The preview server stops when the target buffer is no longer displayed in any
Neovim window, when the target is unloaded, wiped, or renamed, when you run
Stop or Toggle, or when Neovim exits. Closing the browser tab alone does not
stop it. To show the page after closing its tab, use
`:JsonCrackPreviewOpen`, or press `<leader>jp` twice: the first press stops the
old session and the second starts a new one.

## Input support and limits

The parser validates input before passing it to JSON Crack. It does not
silently draw a partial result.

- Maximum input: 1 MiB (1,048,576 bytes), including a UTF-8 byte order mark.
  UTF-8 is required; a leading UTF-8 BOM is removed.
- Maximum nesting depth: 100, with the root container counted as depth 1.
- Maximum graph size: 1,500 rendered nodes. Larger graphs display an explicit
  limit error.
- Supported JSON: standard JSON objects, arrays, strings, finite numbers,
  booleans, and null. Comments, trailing commas, duplicate keys, multiple
  roots, empty input, unsafe integers, and non-finite numbers are errors.
  Decimal fractions use JavaScript number precision.
- Supported YAML: one YAML 1.2 Core document with string mapping keys,
  sequences, strings, finite numbers, booleans, and null. Comments, quoted and
  multiline strings, and flow collections are supported. Multiple documents,
  YAML 1.1 directives, custom or explicit tags, anchors, aliases, non-string
  or duplicate keys, merge key `<<`, and non-finite numbers are errors. Under
  YAML 1.2 Core, values such as `yes`, `no`, and date-like scalars are strings.
  Empty or comment-only YAML is reported as an empty document; explicit `null`
  and `~` are null values.

The performance target is a foreground browser, a local file no larger than
100 KiB, at most 300 rendered nodes, and a nearest-rank p95 of at most 1,000 ms
across 20 saves. On the validation fixture (7,111 bytes, 67 rendered nodes),
measured p95 was 526.674 ms in Playwright Chromium 156.0.8078.4 and 911.385 ms
in Playwright Firefox 157.0, using a headed virtual X11 desktop. This is a
measured result for that environment, not a guarantee for larger inputs,
background tabs, or physical displays.

## Troubleshooting

- **The command says to save the file:** write a named `.json`, `.yaml`, or
  `.yml` file first. The server reads the saved file, not Neovim's in-memory
  text.
- **The browser reports a parse or limit error:** check JSON syntax or the
  supported YAML subset, then reduce input size, nesting, or node count as
  needed. A later valid save recovers the preview.
- **Python or distribution files are missing:** check `python3 --version`,
  confirm the installed checkout contains `server/` and `dist/`, and make sure
  `dir` points to the repository root. Runtime installation does not rebuild
  `dist/`.
- **No browser opens:** use a Linux desktop with a configured default browser
  and check that `vim.ui.open` works in Neovim. Remote and headless sessions
  are not supported.
- **An old tab says it cannot reconnect:** start a new preview from Neovim.
  Stopped sessions do not transfer to a later session.

## Development and validation

The pinned web build toolchain is Node.js 22.19.0 and npm 10.9.3. Install the
lockfile dependencies and browser engines from the repository root:

```sh
npm --prefix web ci
npx --prefix web playwright install --with-deps chromium firefox
```

The Neovim tests use `plenary.nvim` as a sibling checkout at
`../plenary.nvim`. Install the pinned `stylua` 2.6.0 and `selene` 0.32.0 tools
and Neovim 0.11.6 or newer for the full suite. The GitHub Actions workflow
provisions those tools and checks Neovim 0.11.6, stable, and nightly; nightly
is advisory.

```sh
make lint        # Lua lint, TypeScript typecheck, Python syntax check
make test        # Python, Lua/plenary, web, renderer, integration, and browser E2E suites
make build       # regenerate dist/ from web/package-lock.json
make verify-dist # rebuild and reject changed, missing, new, or invalid distribution files
make check       # lint, test, and verify-dist
```

`make test` and `make check` need Node/npm and the Playwright browsers. The
plugin runtime does not. `make build` does not access the network; it uses the
installed lockfile dependencies. `dist/THIRD-PARTY-NOTICES.md`,
`dist/THIRD-PARTY-NOTICES.json`, and `dist/licenses/` contain the generated
runtime dependency attribution and license texts. `LICENSE` covers this
project's own code; third-party terms remain separate.

## Release status

No public repository URL or package coordinates have been selected for this
checkout. Confirm the publishing repository and review the generated
distribution notices before advertising a remote `lazy.nvim` installation or
creating a release. CI validates changes but does not publish artifacts.

## License

This project's code is distributed under the MIT License in [`LICENSE`](LICENSE). The web distribution also contains the applicable dependency license and notice texts; see [`dist/THIRD-PARTY-NOTICES.md`](dist/THIRD-PARTY-NOTICES.md).
