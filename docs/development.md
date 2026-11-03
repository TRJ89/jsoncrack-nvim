# Development

[English README](../README.md) · [日本語 README](../README.ja.md)

This guide covers loading a local checkout and running the contributor checks.
Node.js and npm are development tools only; the plugin runtime uses Python and
the checked-in `dist/` assets.

## Load a local checkout

For a contributor checkout, use `lazy.nvim`'s `dir` option with the path to
your clone. For LazyVim, save this spec as
`~/.config/nvim/lua/plugins/jsoncrack.lua` and change the path if needed:

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
        "<leader>cj",
        "<cmd>JsonCrackPreviewToggle<cr>",
        desc = "Toggle JSON Crack preview",
      },
    },
  },
}
```

The `<leader>cj` key is optional. The three commands can load the plugin on
demand; there is no `setup()` call or build hook. The checkout must include
`server/` and `dist/`.

## Development requirements

- Python 3.10 or newer for the server and test tooling.
- Node.js 22.23.4 and npm 10.9.9, pinned in `.node-version` and
  `web/package.json`.
- Neovim 0.11.0 or newer for the supported minimum; the full pinned `make check`
  job uses Neovim 0.11.6.
- `plenary.nvim` checked out as a sibling at `../plenary.nvim` for Lua tests.
- Stylua 2.6.0 and Selene 0.32.0 for Lua linting.
- Playwright 1.64.1 with Chromium and Firefox for renderer and browser tests.

From the repository root, install the lockfile dependencies and browser engines:

```sh
npm --prefix web ci
npx --prefix web playwright install --with-deps chromium firefox
```

Pyright 1.1.407 is installed from the lockfile. Its configuration checks
`server/`, `scripts/`, and `tests/` in standard mode, targeting Linux and
Python 3.10. No global Pyright or Mason installation is needed.

## Validation commands

| Command | Checks |
| --- | --- |
| `make lint` | Lua lint, TypeScript typecheck, Python syntax and type checks |
| `make lint-python` | Python `compileall` and pinned Pyright typecheck |
| `npm --prefix web run typecheck:python` | Pinned Pyright check for Python sources |
| `make test` | Python, Lua/Plenary, web, renderer, integration, and browser E2E tests |
| `make build` | Regenerates the browser assets and dependency notices in `dist/` |
| `make verify-dist` | Rebuilds `dist/` and checks its tracked inventory |
| `make check` | Runs lint, tests, and distribution verification |

The full test and check targets require Node/npm and the Playwright browsers.
`make build` uses installed lockfile dependencies and does not fetch packages.
The plugin itself does not need these development tools.

## Release maintenance

Before a release, run `make check`, confirm the hosted GitHub Actions results,
and review the generated notices in `dist/THIRD-PARTY-NOTICES.md`,
`dist/THIRD-PARTY-NOTICES.json`, and `dist/licenses/`. CI validates changes
but does not publish artifacts.

Before a public release, a repository administrator must enable GitHub private
vulnerability reporting under **Settings → Security and quality → Advanced
Security → Private vulnerability reporting**. Confirm that the repository's
advisory form is available and that maintainers receive its notifications.
See [GitHub's setup guide](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
for the current settings steps.
`SECURITY.md` links to the form and describes the fallback if it is unavailable;
the document does not change GitHub settings. Confirm the hosted checks on the
release candidate as well; local validation does not establish a hosted Actions
result.

The current assessment of the npm advisory finding is in the
[2026-11-01 validation record](validation.md#npm-advisory-assessment-2026-11-01).

The project's own code is covered by [LICENSE](../LICENSE). The web
distribution's dependency terms and license texts are listed separately in
`dist/THIRD-PARTY-NOTICES.md` and `dist/licenses/`.
