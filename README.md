# JsonCrack Preview for Neovim

[日本語](README.ja.md)

Preview a saved JSON or YAML file as a graph in the official JSON Crack view in
your default browser. Save the file to refresh the graph. The preview server and
browser assets run locally.

This is an unofficial Neovim integration and is not affiliated with or endorsed
by JSON Crack.

## Features

- Preview saved `.json`, `.yaml`, and `.yml` files.
- Refresh the graph automatically when the file is saved.
- Run the preview locally with the bundled browser assets and a small Python
  server.

## Requirements

- Neovim 0.11 or newer.
- Python 3.10 or newer available as `python3`.
- A Linux desktop session with a default browser and working `vim.ui.open`.
- LazyVim with `lazy.nvim`, or another configuration that loads this plugin's
  `plugin/jsoncrack.lua`.

Node.js, npm, pip, a network connection, and an install-time build are not
needed to run the plugin.

## Installation

The planned repository is `TRJ89/jsoncrack-nvim`, but it has not been published
yet. The spec below documents the intended `lazy.nvim` installation and will be
usable after publication. For a local checkout in the meantime, see
[Development](docs/development.md).

With LazyVim, save this as `~/.config/nvim/lua/plugins/jsoncrack.lua`:

```lua
return {
  {
    "TRJ89/jsoncrack-nvim",
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

The `<leader>cj` mapping is optional; change or remove it to fit your setup.
There is no `setup()` call or build hook.

## Usage

Open a saved JSON or YAML file, then use your mapped key or one of these
commands:

- `:JsonCrackPreviewToggle` starts a preview for the current buffer. If a
  preview is already running, it stops that session regardless of which buffer
  is current.
- `:JsonCrackPreviewOpen` starts a preview if none is running. For the active
  target, it asks the default browser to open the current preview URL again. If
  a different target is active, stop that preview first. The browser may open a
  new tab; reuse of an existing tab is not guaranteed.
- `:JsonCrackPreviewStop` stops the server. Any open browser tab stays open and
  reports that it cannot reconnect.

The preview reads the saved file from disk. Unsaved edits are excluded; write
them with `:write`. The browser checks for saved changes every 500 ms and
updates without a manual reload. The server stops when the target buffer is no
longer displayed, is unloaded, wiped, or renamed, or when Neovim exits. If you
close the browser tab, use `:JsonCrackPreviewOpen` to show the page again;
closing a tab alone does not stop the server.

## Limits

Only saved, readable regular files with a `.json`, `.yaml`, or `.yml` extension
are supported; JSONC and other file types are not. The parser has explicit
input, nesting, and graph-size limits, and rejects unsupported syntax instead
of drawing a partial result. See [Input support](docs/input-support.md) for the
complete contract and [the validation record](docs/validation.md#performance-method-and-results)
for measured performance and its conditions.

This MVP supports Linux desktop sessions. Headless Neovim, SSH sessions,
multiple simultaneous previews in one Neovim process, following a renamed
buffer, and automatic shutdown when a browser tab closes are outside its scope.

## Troubleshooting and support

- **The command asks you to save the file:** write a named `.json`, `.yaml`, or
  `.yml` file first. The preview uses the on-disk contents.
- **The browser shows a parse or limit error:** check the file against the
  [supported input rules](docs/input-support.md), then reduce its size, nesting,
  or number of rendered nodes if needed. A later valid save updates the view.
- **Python or browser assets are missing:** check `python3 --version` and make
  sure the plugin points to a complete checkout containing `server/` and
  `dist/`.
- **No browser opens:** use a Linux desktop with a configured default browser
  and check that `vim.ui.open` works in Neovim. Remote and headless sessions
  are not supported.
- **An old tab cannot reconnect:** start or reopen a preview from Neovim.

Once the repository is published, use its issue tracker to report a problem or
request another environment. Include your operating system, Neovim version and
setup, and the use case. I may consider support requests, but support for other
environments is not guaranteed.

## Development

Contributor setup, local-checkout loading, validation commands, and the
pre-publication checklist are in [docs/development.md](docs/development.md).

## License

The project's code is distributed under the MIT License; see [LICENSE](LICENSE).
The bundled web distribution also includes dependency notices and license
texts in `dist/THIRD-PARTY-NOTICES.md` and `dist/licenses/`.
