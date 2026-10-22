local plugin_root = vim.env.JSONCRACK_PLUGIN_ROOT or vim.fn.getcwd()
local url_log = vim.env.JSONCRACK_URL_LOG
local notification_log = vim.env.JSONCRACK_NOTIFICATION_LOG

vim.opt.runtimepath:prepend(plugin_root)
vim.opt.swapfile = false
vim.opt.shadafile = "NONE"

local function append_line(path, value)
    if not path or path == "" then
        return
    end
    vim.fn.writefile({ tostring(value) }, path, "a")
end

vim.notify = function(message)
    append_line(notification_log, message)
end

if vim.env.JSONCRACK_CAPTURE_OPEN == "1" then
    vim.ui.open = function(url)
        append_line(url_log, url)
        return true
    end
else
    -- Keep process integration tests isolated from the desktop browser.
    vim.ui.open = function()
        return true
    end
end

vim.cmd("runtime plugin/jsoncrack.lua")

local bridge = {}

function bridge.command(action)
    local commands = {
        toggle = "JsonCrackPreviewToggle",
        open = "JsonCrackPreviewOpen",
        stop = "JsonCrackPreviewStop",
        split_other = "vsplit | enew",
        close_window = "close",
        hide_target = "enew",
        quit = "qa!",
    }
    local command = commands[action]
    if not command then
        error("unknown bridge action")
    end
    vim.cmd(command)
    return true
end

function bridge.rename(path)
    vim.cmd("file " .. vim.fn.fnameescape(path))
    return vim.api.nvim_get_current_buf()
end

function bridge.edit(path)
    vim.cmd("edit! " .. vim.fn.fnameescape(path))
    return vim.api.nvim_get_current_buf()
end

function bridge.save(staged_path)
    local file = assert(io.open(staged_path, "rb"))
    local content = file:read("*a")
    file:close()

    local lines = vim.split(content, "\n", { plain = true, trimempty = false })
    local has_eol = content:sub(-1) == "\n"
    if has_eol then
        table.remove(lines)
    end
    if #lines == 0 then
        lines = { "" }
    end

    vim.api.nvim_buf_set_lines(0, 0, -1, false, lines)
    vim.api.nvim_set_option_value("endofline", has_eol, { buf = 0 })
    vim.cmd("silent write")
    return string.format("%.0f", vim.uv.hrtime())
end

function bridge.ping()
    return vim.api.nvim_get_current_buf()
end

_G.JsonCrackBridge = bridge
