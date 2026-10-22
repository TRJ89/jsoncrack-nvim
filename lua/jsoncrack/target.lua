local uv = vim.uv
local M = {}

local function finish(callback, err, target)
    vim.schedule(function()
        callback(err, target)
    end)
end

local function unsupported(message, callback)
    finish(callback, message)
end

local function same_buffer(bufnr, name)
    return vim.api.nvim_buf_is_valid(bufnr)
        and vim.api.nvim_buf_get_name(bufnr) == name
        and vim.api.nvim_get_option_value("buftype", { buf = bufnr }) == ""
end

function M.resolve(bufnr, callback)
    if not vim.api.nvim_buf_is_valid(bufnr) then
        unsupported("The current buffer is no longer available.", callback)
        return
    end

    local buftype = vim.api.nvim_get_option_value("buftype", { buf = bufnr })
    local name = vim.api.nvim_buf_get_name(bufnr)
    if buftype ~= "" then
        unsupported("Only normal file buffers can be previewed.", callback)
        return
    end
    if name == "" then
        unsupported("Save the file before opening a preview.", callback)
        return
    end
    if name:match("^%a[%w+.-]*://") then
        unsupported("URI buffers cannot be previewed.", callback)
        return
    end

    local absolute = vim.fn.fnamemodify(name, ":p")
    local extension = absolute:match("%.([^./\\]+)$")
    extension = extension and extension:lower() or ""
    local format
    if extension == "json" then
        format = "json"
    elseif extension == "yaml" or extension == "yml" then
        format = "yaml"
    else
        unsupported("Preview supports only .json, .yaml, and .yml files.", callback)
        return
    end

    uv.fs_realpath(
        absolute,
        vim.schedule_wrap(function(realpath_err, realpath)
            if realpath_err or not realpath then
                unsupported("Save the file before opening a preview.", callback)
                return
            end
            if not same_buffer(bufnr, name) then
                unsupported("The target buffer changed while it was being checked.", callback)
                return
            end

            uv.fs_stat(
                realpath,
                vim.schedule_wrap(function(stat_err, stat)
                    if stat_err or not stat or stat.type ~= "file" then
                        unsupported("The preview target must be an existing regular file.", callback)
                        return
                    end
                    if not same_buffer(bufnr, name) then
                        unsupported("The target buffer changed while it was being checked.", callback)
                        return
                    end

                    uv.fs_access(
                        realpath,
                        "R",
                        vim.schedule_wrap(function(access_err, readable)
                            if access_err or not readable then
                                unsupported("The preview target is not readable.", callback)
                                return
                            end
                            if not same_buffer(bufnr, name) then
                                unsupported("The target buffer changed while it was being checked.", callback)
                                return
                            end

                            finish(callback, nil, {
                                bufnr = bufnr,
                                path = realpath,
                                format = format,
                                display_name = vim.fs.basename(realpath),
                                modified = vim.api.nvim_get_option_value("modified", { buf = bufnr }),
                            })
                        end)
                    )
                end)
            )
        end)
    )
end

return M
