local assert = require("luassert")
local M = {}

local tracked_buffers = {}
local tracked_directories = {}
local base_window = vim.api.nvim_get_current_win()

function M.make_file(suffix, contents, special_name)
    local directory = vim.fn.tempname()
    assert.equals(1, vim.fn.mkdir(directory, "p"))
    local filename = special_name or ("fixture" .. (suffix or ".json"))
    local path = directory .. "/" .. filename
    local file = assert(io.open(path, "wb"))
    file:write(contents or "{}\n")
    file:close()
    tracked_directories[#tracked_directories + 1] = directory
    return path
end

function M.buffer(path, lines)
    local bufnr = vim.api.nvim_create_buf(false, false)
    tracked_buffers[#tracked_buffers + 1] = bufnr
    if path then
        vim.api.nvim_buf_set_name(bufnr, path)
    end
    if lines then
        vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, lines)
    end
    return bufnr
end

function M.file_buffer(suffix, contents, special_name)
    local path = M.make_file(suffix, contents, special_name)
    local lines = vim.split(contents or "{}\n", "\n", { plain = true })
    if lines[#lines] == "" then
        table.remove(lines)
    end
    local bufnr = M.buffer(path, lines)
    vim.api.nvim_set_option_value("modified", false, { buf = bufnr })
    return bufnr, path
end

function M.show(bufnr, win)
    vim.api.nvim_win_set_buf(win or vim.api.nvim_get_current_win(), bufnr)
end

function M.await(predicate, timeout)
    local result = vim.wait(timeout or 1000, predicate)
    return result ~= -1 and result ~= -2 and result ~= false
end

function M.target_for(bufnr)
    local path = vim.api.nvim_buf_get_name(bufnr)
    return {
        bufnr = bufnr,
        path = vim.uv.fs_realpath(path),
        format = path:lower():match("%.ya?ml$") and "yaml" or "json",
        display_name = vim.fn.fnamemodify(path, ":t"),
        modified = vim.api.nvim_get_option_value("modified", { buf = bufnr }),
    }
end

function M.fake_resolver()
    local resolver = { callbacks = {}, buffers = {} }
    function resolver.resolve(bufnr, callback)
        resolver.buffers[#resolver.buffers + 1] = bufnr
        resolver.callbacks[#resolver.callbacks + 1] = callback
    end
    function resolver.succeed(index, target)
        resolver.callbacks[index](nil, target or M.target_for(resolver.buffers[index]))
    end
    function resolver.fail(index, message)
        resolver.callbacks[index](message or "target unavailable")
    end
    return resolver
end

function M.fake_process()
    local fake = { callbacks = {}, handles = {}, targets = {}, start_count = 0, stop_count = 0 }
    function fake.start(target, callbacks)
        fake.start_count = fake.start_count + 1
        fake.targets[#fake.targets + 1] = target
        fake.callbacks[#fake.callbacks + 1] = callbacks
        local handle = {}
        function handle:stop()
            fake.stop_count = fake.stop_count + 1
        end
        fake.handles[#fake.handles + 1] = handle
        return handle
    end
    function fake.ready(index, port, token)
        fake.callbacks[index].on_ready({ port = port or 12345, token = token or string.rep("a", 64) })
    end
    function fake.error(index, message)
        fake.callbacks[index].on_error(message or "startup failed")
    end
    function fake.exit(index, code)
        fake.callbacks[index].on_exit(code or 0)
    end
    return fake
end

function M.capture_notifications()
    local notices = {}
    return notices, function(message)
        notices[#notices + 1] = message
    end
end

function M.session_dependencies(session, resolver, fake_process, extra)
    local urls = {}
    local notices, notify = M.capture_notifications()
    extra = extra or {}
    local instance = session.new({
        resolve = function(bufnr, callback)
            resolver.resolve(bufnr, callback)
        end,
        start_process = function(target, callbacks)
            return fake_process.start(target, callbacks)
        end,
        open_url = function(url)
            urls[#urls + 1] = url
            if extra.open_url then
                return extra.open_url(url)
            end
            return true
        end,
        notify = notify,
    })
    return instance, urls, notices
end

function M.write_executable(directory, name, source)
    vim.fn.mkdir(directory, "p")
    tracked_directories[#tracked_directories + 1] = directory
    local path = directory .. "/" .. name
    local file = assert(io.open(path, "wb"))
    file:write("#!/usr/bin/python3\n", source)
    file:close()
    assert.equals(1, vim.fn.setfperm(path, "rwx------"))
    return path
end

function M.http_request(port, token)
    local client = vim.uv.new_tcp()
    local response
    local chunks = {}
    client:connect(
        "127.0.0.1",
        port,
        vim.schedule_wrap(function(connect_error)
            if connect_error then
                response = { error = connect_error }
                client:close()
                return
            end
            client:read_start(vim.schedule_wrap(function(read_error, data)
                if read_error then
                    response = { error = read_error }
                    client:read_stop()
                    client:close()
                elseif data then
                    chunks[#chunks + 1] = data
                else
                    response = { text = table.concat(chunks) }
                    client:read_stop()
                    client:close()
                end
            end))
            client:write(table.concat({
                "GET /api/snapshot HTTP/1.1\r\n",
                "Host: 127.0.0.1:" .. port .. "\r\n",
                "Authorization: Bearer " .. token .. "\r\n",
                "Connection: close\r\n\r\n",
            }))
        end)
    )
    assert.is_true(
        M.await(function()
            return response ~= nil
        end, 3000),
        "HTTP request did not complete"
    )
    assert.is_nil(response.error, tostring(response.error))
    return response.text
end

function M.port_is_closed(port)
    local client = vim.uv.new_tcp()
    local connected
    client:connect(
        "127.0.0.1",
        port,
        vim.schedule_wrap(function(err)
            connected = err == nil
            client:close()
        end)
    )
    assert.is_true(
        M.await(function()
            return connected ~= nil
        end, 1000),
        "TCP connection probe did not complete"
    )
    return not connected
end

function M.cleanup()
    if vim.api.nvim_win_is_valid(base_window) then
        for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
            if win ~= base_window and vim.api.nvim_win_is_valid(win) then
                pcall(vim.api.nvim_win_close, win, true)
            end
        end
        local scratch = vim.api.nvim_create_buf(false, true)
        pcall(vim.api.nvim_win_set_buf, base_window, scratch)
    end
    for _, bufnr in ipairs(tracked_buffers) do
        if vim.api.nvim_buf_is_valid(bufnr) then
            pcall(vim.api.nvim_buf_delete, bufnr, { force = true })
        end
    end
    tracked_buffers = {}
    for _, directory in ipairs(tracked_directories) do
        vim.fn.delete(directory, "rf")
    end
    tracked_directories = {}
end

return M
