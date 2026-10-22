local assert = require("luassert")
local support = require("tests.lua.support")
local original_open = vim.ui.open
local original_notify = vim.notify

local function open_until_ready(opened)
    vim.api.nvim_cmd({ cmd = "JsonCrackPreviewOpen" }, {})
    assert.is_true(vim.wait(5000, function()
        if #opened == 0 then
            -- A preceding real-process case may observe the listener close
            -- before Neovim delivers on_exit. The session rejects Open until
            -- then, so retry through the public command.
            vim.api.nvim_cmd({ cmd = "JsonCrackPreviewOpen" }, {})
        end
        return #opened > 0
    end, 200))
end

describe("jsoncrack commands", function()
    after_each(function()
        vim.ui.open = original_open
        vim.notify = original_notify
        support.cleanup()
    end)

    it("registers commands without setup, remains safe to source twice, and adds no mapping", function()
        assert.is_nil(require("jsoncrack").setup)
        local path = vim.fn.getcwd() .. "/plugin/jsoncrack.lua"
        dofile(path)
        local ok, err = pcall(dofile, path)
        assert.is_true(ok, tostring(err))
        local commands = vim.api.nvim_get_commands({})
        assert.is_truthy(commands.JsonCrackPreviewToggle)
        assert.is_truthy(commands.JsonCrackPreviewOpen)
        assert.is_truthy(commands.JsonCrackPreviewStop)
        assert.are.equal("", vim.fn.maparg("\\jp", "n"))
    end)

    it("stops the child when vim.ui.open reports a launch failure", function()
        local bufnr = support.file_buffer(".json", "{}")
        support.show(bufnr)
        local opened, notices = {}, {}
        vim.ui.open = function(url)
            opened[#opened + 1] = url
            return nil, "no browser handler"
        end
        vim.notify = function(message)
            if message:match("^The browser could not be opened:") then
                notices[#notices + 1] = message
            end
        end
        open_until_ready(opened)
        local port = tonumber(opened[1]:match("^http://127%.0%.0%.1:(%d+)/#token="))
        assert.is_truthy(port)
        assert.is_true(support.await(function()
            return support.port_is_closed(port)
        end, 3000))
        assert.are.equal(1, #notices)
    end)

    it("opens the real bundled server through the command and stops it", function()
        local bufnr = support.file_buffer(".json", '{"from":"command"}\n')
        support.show(bufnr)
        local opened = {}
        vim.ui.open = function(url)
            opened[#opened + 1] = url
            return true
        end
        open_until_ready(opened)
        local port = opened[1]:match("^http://127%.0%.0%.1:(%d+)/#token=")
        assert.is_truthy(port)
        vim.api.nvim_cmd({ cmd = "JsonCrackPreviewStop" }, {})
        assert.is_true(support.await(function()
            return support.port_is_closed(tonumber(port))
        end, 3000))
    end)
end)
