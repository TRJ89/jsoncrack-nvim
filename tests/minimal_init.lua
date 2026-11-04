local root = vim.fn.getcwd()
local plenary = root .. "/../plenary.nvim"

-- Plenary runs files in parallel, and all instances share Neovim's state directory.
vim.o.swapfile = false

local function fail(message)
    vim.api.nvim_err_writeln("jsoncrack test bootstrap: " .. message)
    vim.cmd("cquit 1")
end

if vim.fn.isdirectory(root .. "/lua/jsoncrack") ~= 1 then
    fail("run tests from the repository root")
    return
end
if vim.fn.isdirectory(plenary) ~= 1 then
    fail("missing sibling dependency ../plenary.nvim")
    return
end

vim.opt.runtimepath:prepend(root)
vim.opt.runtimepath:append(plenary)
local ok, err = pcall(vim.cmd, "runtime! plugin/plenary.vim")
if not ok or vim.fn.exists(":PlenaryBustedDirectory") ~= 2 then
    fail("could not load plenary.nvim: " .. tostring(err))
end
