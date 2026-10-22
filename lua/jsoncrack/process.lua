local uv = vim.uv
local M = {}

local START_TIMEOUT_MS = 5000
local STOP_GRACE_MS = 1000
local MAX_STDOUT_LINE_BYTES = 64 * 1024
local MAX_STDERR_BYTES = 16 * 1024

local function plugin_root()
    local source = debug.getinfo(1, "S").source
    return vim.fn.fnamemodify(source:sub(2), ":p:h:h:h")
end

local function close_timer(timer)
    if timer and not timer:is_closing() then
        timer:stop()
        timer:close()
    end
end

local function json_ready(line)
    local ok, message = pcall(vim.json.decode, line)
    if not ok or type(message) ~= "table" then
        return nil, "The preview server returned an invalid startup response."
    end
    if message.event == "error" and message.code == "START_FAILED" and type(message.message) == "string" then
        return nil, message.message
    end
    if
        message.event ~= "ready"
        or message.protocol ~= 1
        or type(message.port) ~= "number"
        or message.port % 1 ~= 0
        or message.port < 1
        or message.port > 65535
        or type(message.token) ~= "string"
        or #message.token ~= 64
        or not message.token:match("^[0-9a-f]+$")
    then
        return nil, "The preview server returned an invalid startup response."
    end
    return { port = message.port, token = message.token }
end

function M.start(target, callbacks)
    local completed_exit = false
    local error_reported = false
    local ready_reported = false
    local stopping = false
    local job
    local child_pid
    local startup_timer
    local stop_timer
    local output = ""
    local stderr_size = 0
    local stderr_chunks = {}

    local handle = {}

    local function report_error(message)
        if error_reported then
            return
        end
        error_reported = true
        callbacks.on_error(message)
    end

    local function report_exit(code, event_job)
        if completed_exit or (job and event_job and event_job ~= job) then
            return
        end
        completed_exit = true
        close_timer(startup_timer)
        close_timer(stop_timer)
        if not ready_reported and not error_reported then
            report_error("The preview server exited before it was ready.")
        end
        callbacks.on_exit(code)
    end

    local function stop_after_grace()
        close_timer(stop_timer)
        if completed_exit or not job then
            return
        end
        if stopping then
            pcall(vim.fn.jobstop, job)
            stop_timer = uv.new_timer()
            stop_timer:start(
                STOP_GRACE_MS,
                0,
                vim.schedule_wrap(function()
                    close_timer(stop_timer)
                    if completed_exit or vim.fn.has("linux") ~= 1 then
                        return
                    end
                    if child_pid and child_pid > 0 then
                        pcall(uv.kill, child_pid, 9)
                    end
                end)
            )
        end
    end

    function handle:stop()
        if stopping or completed_exit then
            return
        end
        stopping = true
        close_timer(startup_timer)
        if not job then
            return
        end
        pcall(vim.fn.chanclose, job, "stdin")
        stop_timer = uv.new_timer()
        stop_timer:start(STOP_GRACE_MS, 0, vim.schedule_wrap(stop_after_grace))
    end

    local function process_line(line)
        if ready_reported or error_reported then
            return
        end
        if #line > MAX_STDOUT_LINE_BYTES then
            report_error("The preview server returned an oversized startup response.")
            handle:stop()
            return
        end
        local ready, err = json_ready(line)
        if not ready then
            report_error(err)
            handle:stop()
            return
        end
        ready_reported = true
        close_timer(startup_timer)
        callbacks.on_ready(ready)
    end

    local function on_stdout(_, data)
        if completed_exit or not data then
            return
        end
        for index, part in ipairs(data) do
            output = output .. part
            if index < #data then
                output = output .. "\n"
            end
            local newline = output:find("\n", 1, true)
            while newline do
                local line = output:sub(1, newline - 1)
                output = output:sub(newline + 1)
                if line:sub(-1) == "\r" then
                    line = line:sub(1, -2)
                end
                process_line(line)
                newline = output:find("\n", 1, true)
            end
            if #output > MAX_STDOUT_LINE_BYTES then
                report_error("The preview server returned an oversized startup response.")
                handle:stop()
                output = ""
                return
            end
        end
    end

    local function on_stderr(_, data)
        if completed_exit or not data then
            return
        end
        local text = table.concat(data, "\n")
        local remaining = MAX_STDERR_BYTES - stderr_size
        if remaining > 0 then
            local retained = text:sub(1, remaining)
            stderr_chunks[#stderr_chunks + 1] = retained
            stderr_size = stderr_size + #retained
        end
    end

    local root = plugin_root()
    local python = vim.fn.exepath("python3")
    if python == "" then
        report_error("Python 3 was not found on PATH. Install Python 3 and try again.")
        report_exit(127)
        return handle
    end
    local server_path = root .. "/server/main.py"
    if vim.fn.filereadable(server_path) ~= 1 then
        report_error("The bundled preview server is missing from this installation.")
        report_exit(127)
        return handle
    end
    if
        vim.fn.filereadable(root .. "/dist/index.html") ~= 1
        or vim.fn.filereadable(root .. "/dist/manifest.json") ~= 1
    then
        report_error("The bundled preview assets are missing from this installation.")
        report_exit(127)
        return handle
    end

    local ok, job_or_error = pcall(vim.fn.jobstart, { python, server_path }, {
        stdin = "pipe",
        stdout_buffered = false,
        stderr_buffered = false,
        on_stdout = vim.schedule_wrap(on_stdout),
        on_stderr = vim.schedule_wrap(on_stderr),
        on_exit = vim.schedule_wrap(function(event_job, code)
            report_exit(code, event_job)
        end),
    })
    if not ok or type(job_or_error) ~= "number" or job_or_error <= 0 then
        report_error("The preview server process could not be started.")
        report_exit(127)
        return handle
    end
    job = job_or_error
    local pid_ok, pid = pcall(vim.fn.jobpid, job)
    if pid_ok and type(pid) == "number" and pid > 0 then
        child_pid = pid
    end

    startup_timer = uv.new_timer()
    startup_timer:start(
        START_TIMEOUT_MS,
        0,
        vim.schedule_wrap(function()
            close_timer(startup_timer)
            if not ready_reported and not completed_exit then
                report_error("The preview server did not start within 5 seconds.")
                handle:stop()
            end
        end)
    )

    local encoded_ok, configuration = pcall(vim.json.encode, {
        protocol = 1,
        path = target.path,
        format = target.format,
        display_name = target.display_name,
    })
    if not encoded_ok then
        report_error("The preview target could not be encoded for the server.")
        handle:stop()
        return handle
    end
    local sent, send_result = pcall(vim.fn.chansend, job, configuration .. "\n")
    if not sent or type(send_result) ~= "number" or send_result <= 0 then
        report_error("The preview server did not accept its startup configuration.")
        handle:stop()
    end

    return handle
end

return M
