local M = {}

local function safe_notify(notify, message)
    pcall(notify, message)
end

function M.new(dependencies)
    local state = "stopped"
    local generation = 0
    local target
    local handle
    local url
    local group
    local launching = false
    local error_notified = false

    local function clear_group()
        if group then
            pcall(vim.api.nvim_del_augroup_by_id, group)
            group = nil
        end
    end

    local function notify_error(gen, message)
        if gen ~= generation or error_notified then
            return
        end
        error_notified = true
        safe_notify(dependencies.notify, message)
    end

    local function reset_stopped()
        clear_group()
        state = "stopped"
        target = nil
        handle = nil
        url = nil
        launching = false
    end

    local stop_generation
    local function on_exit(gen, _code)
        if gen ~= generation then
            return
        end
        if state == "stopping" then
            reset_stopped()
            return
        end
        if state == "starting" or state == "running" then
            notify_error(gen, "The preview server stopped unexpectedly.")
            reset_stopped()
        end
    end

    stop_generation = function(gen)
        if gen ~= generation or state == "stopped" or state == "stopping" then
            return
        end
        clear_group()
        url = nil
        if handle or launching then
            state = "stopping"
            if handle then
                pcall(handle.stop, handle)
            end
        else
            generation = generation + 1
            reset_stopped()
        end
    end

    local function fail_start(gen, message)
        if gen ~= generation or (state ~= "starting" and state ~= "running") then
            return
        end
        notify_error(gen, message)
        stop_generation(gen)
    end

    local function try_open(gen, current_url)
        local ok, opened, err = pcall(dependencies.open_url, current_url)
        if not ok then
            fail_start(gen, "The browser could not be opened: " .. tostring(opened))
        elseif opened == nil or opened == false or err ~= nil then
            fail_start(gen, "The browser could not be opened: " .. tostring(err or "no handler is available"))
        end
    end

    local function attach_lifecycle(bufnr, gen)
        group = vim.api.nvim_create_augroup("JsonCrackPreview" .. gen, { clear = true })
        local function cancel_if_current()
            if gen == generation then
                stop_generation(gen)
            end
        end
        vim.api.nvim_create_autocmd({ "BufHidden", "BufUnload", "BufWipeout", "BufFilePost" }, {
            group = group,
            buffer = bufnr,
            callback = cancel_if_current,
        })
        vim.api.nvim_create_autocmd("VimLeavePre", {
            group = group,
            callback = cancel_if_current,
        })
    end

    local function start(bufnr)
        if type(bufnr) ~= "number" or not vim.api.nvim_buf_is_valid(bufnr) then
            safe_notify(dependencies.notify, "The current buffer cannot be previewed.")
            return
        end

        generation = generation + 1
        local gen = generation
        state = "starting"
        target = nil
        handle = nil
        url = nil
        launching = false
        error_notified = false

        local attached, attach_error = pcall(attach_lifecycle, bufnr, gen)
        if not attached then
            reset_stopped()
            safe_notify(dependencies.notify, "Could not monitor the preview buffer: " .. tostring(attach_error))
            return
        end

        local function resolved(err, resolved_target)
            if gen ~= generation or state ~= "starting" then
                return
            end
            if err or not resolved_target then
                notify_error(gen, err or "The preview target could not be resolved.")
                reset_stopped()
                return
            end

            target = resolved_target
            if resolved_target.modified then
                safe_notify(dependencies.notify, "Previewing the saved file; unsaved buffer changes are not included.")
            end

            local callbacks = {
                on_ready = function(ready)
                    if gen ~= generation or state ~= "starting" then
                        return
                    end
                    url = "http://127.0.0.1:" .. ready.port .. "/#token=" .. ready.token
                    state = "running"
                    try_open(gen, url)
                end,
                on_error = function(message)
                    if gen == generation and (state == "starting" or state == "running") then
                        fail_start(gen, message or "The preview server failed to start.")
                    end
                end,
                on_exit = function(code)
                    on_exit(gen, code)
                end,
            }

            launching = true
            local ok, child = pcall(dependencies.start_process, resolved_target, callbacks)
            launching = false
            if not ok then
                fail_start(gen, "Could not start the preview server: " .. tostring(child))
                return
            end
            if not child or type(child.stop) ~= "function" then
                fail_start(gen, "The preview server did not return a process handle.")
                return
            end
            handle = child
            if gen ~= generation or state == "stopping" or state == "stopped" then
                pcall(child.stop, child)
            end
        end

        local ok, err = pcall(dependencies.resolve, bufnr, resolved)
        if not ok then
            fail_start(gen, "Could not check the preview target: " .. tostring(err))
        end
    end

    local session = {}

    function session.toggle(bufnr)
        if state == "stopped" then
            start(bufnr)
        elseif state == "stopping" then
            safe_notify(dependencies.notify, "The preview is stopping. Try again after it exits.")
        else
            stop_generation(generation)
        end
    end

    function session.open(bufnr)
        if state == "stopped" then
            start(bufnr)
        elseif state == "starting" then
            safe_notify(dependencies.notify, "The preview is starting.")
        elseif state == "stopping" then
            safe_notify(dependencies.notify, "The preview is stopping. Try again after it exits.")
        elseif target and target.bufnr == bufnr then
            try_open(generation, url)
        else
            safe_notify(dependencies.notify, "A preview is already open for another buffer. Stop it first.")
        end
    end

    function session.stop()
        if state == "stopped" then
            return
        end
        if state == "stopping" then
            return
        end
        stop_generation(generation)
    end

    return session
end

return M
