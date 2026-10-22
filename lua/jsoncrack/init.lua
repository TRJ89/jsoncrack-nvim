local target = require("jsoncrack.target")
local process = require("jsoncrack.process")
local session_module = require("jsoncrack.session")
local M = {}

local current_session

local function get_session()
    if not current_session then
        current_session = session_module.new({
            resolve = target.resolve,
            start_process = process.start,
            open_url = function(url)
                local opened, err = vim.ui.open(url)
                if not opened then
                    return nil, err
                end
                return true
            end,
            notify = vim.notify,
        })
    end
    return current_session
end

function M.toggle()
    get_session().toggle(vim.api.nvim_get_current_buf())
end

function M.open()
    get_session().open(vim.api.nvim_get_current_buf())
end

function M.stop()
    if current_session then
        current_session.stop()
    end
end

return M
