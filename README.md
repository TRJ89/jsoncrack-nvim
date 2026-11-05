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

Install from [GitHub](https://github.com/TRJ89/jsoncrack-nvim). With LazyVim,
save this as `~/.config/nvim/lua/plugins/jsoncrack.lua`:

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

For contributor checkouts, see [Development](docs/development.md).

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

Click a graph node to open its full content and JSON Path. Primitive values and
arrays show their complete JSON values. Object nodes show their direct primitive
properties and empty containers; non-empty child containers have their own
nodes and are summarized in the dialog. Content and path can be copied
separately, and the dialog closes with its close button, Escape, or a backdrop
click. The dialog uses most of the available screen; long JSON stays on one
line and can be scrolled horizontally and vertically. Its text remains
selectable. Empty `{}` and `[]` roots include a **View details** action. A new valid
saved graph closes the dialog; an invalid save retains the last valid graph and
its open details.

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

Use the [issue tracker](https://github.com/TRJ89/jsoncrack-nvim/issues) to
report a problem or request another environment. Include your operating system,
Neovim version and setup, and the use case. I may consider support requests,
but support for other environments is not guaranteed.

For possible security vulnerabilities, follow the [security policy](SECURITY.md).
Do not post vulnerability details in a public issue.

## Development

Contributor setup, local-checkout loading, validation commands, and release
maintenance notes are in [docs/development.md](docs/development.md).

## Acknowledgements

Special thanks to [JSON Crack](https://jsoncrack.com/) and the authors of
[`jsoncrack-react`](https://www.npmjs.com/package/jsoncrack-react) for making the
graph visualization used by this plugin available.

This project also builds on [React](https://github.com/facebook/react),
[`jsonc-parser`](https://github.com/microsoft/node-jsonc-parser),
[`yaml`](https://eemeli.org/yaml/), [Reaflow](https://github.com/reaviz/reaflow),
[`elkjs`](https://github.com/kieler/elkjs), and other open-source packages.
Thank you to all their maintainers and contributors, including those behind the
tools used to develop and test this plugin.

## License

The project's code is distributed under the MIT License; see [LICENSE](LICENSE).
The bundled web distribution also includes dependency notices and license
texts in `dist/THIRD-PARTY-NOTICES.md` and `dist/licenses/`.
