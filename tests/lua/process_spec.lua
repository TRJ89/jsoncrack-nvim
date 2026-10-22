local assert = require("luassert")
local support = require("tests.lua.support")
local process = require("jsoncrack.process")

local original_path = vim.env.PATH

describe("jsoncrack server process", function()
    after_each(function()
        vim.env.PATH = original_path
        support.cleanup()
    end)

    it("reports ready from the real bundled server and exits after EOF", function()
        local bufnr, path = support.file_buffer(".json", '{"name":"preview"}\n', "日本語 ' $().json")
        local target = support.target_for(bufnr)
        local seen = { ready = 0, errors = 0, exits = 0 }
        local handle = process.start(target, {
            on_ready = function(value)
                seen.ready = seen.ready + 1
                seen.value = value
            end,
            on_error = function(message)
                seen.errors = seen.errors + 1
                seen.error = message
            end,
            on_exit = function(code)
                seen.exits = seen.exits + 1
                seen.code = code
            end,
        })
        assert.is_truthy(handle)
        assert.is_true(support.await(function()
            return seen.ready == 1 or seen.errors > 0
        end))
        assert.are.equal(0, seen.errors, seen.error)
        assert.are.equal(1, seen.ready)
        assert.is_true(seen.value.port >= 1 and seen.value.port <= 65535)
        assert.are.equal(64, #seen.value.token)
        assert.is_true(seen.value.token:match("^[0-9a-f]+$") ~= nil)
        handle:stop()
        assert.is_true(support.await(function()
            return seen.exits == 1
        end))
        assert.are.equal(1, seen.exits)
        assert.are.equal(0, seen.code)
        assert.is_true(path:find("日本語", 1, true) ~= nil)
    end)

    it("parses ready lines split across stdout chunks and ignores stderr content", function()
        local directory = vim.fn.tempname() .. "/interpreter with spaces"
        local fake = support.write_executable(
            directory,
            "python3",
            [[import sys, time
sys.stdin.buffer.readline()
line = b'{"event":"ready","protocol":1,"port":23456,"token":"' + b'a' * 64 + b'"}\n'
sys.stdout.buffer.write(line[:17]); sys.stdout.buffer.flush(); time.sleep(0.05)
sys.stdout.buffer.write(line[17:] + b'{"event":"ignored"}\n'); sys.stdout.buffer.flush()
sys.stderr.write('private-diagnostic-' + ('x' * 20000)); sys.stderr.flush()
sys.stdin.buffer.read()
]]
        )
        local old_path = vim.env.PATH
        vim.env.PATH = directory .. ":" .. old_path
        local seen = { ready = 0, errors = 0, exits = 0 }
        local handle = process.start({ bufnr = 1, path = "/tmp/a.json", format = "json", display_name = "a.json" }, {
            on_ready = function(value)
                seen.ready = seen.ready + 1
                seen.value = value
            end,
            on_error = function(message)
                seen.errors = seen.errors + 1
                seen.error = message
            end,
            on_exit = function()
                seen.exits = seen.exits + 1
            end,
        })
        assert.is_truthy(fake)
        assert.is_true(support.await(function()
            return seen.ready > 0 or seen.errors > 0
        end))
        assert.are.equal(0, seen.errors, seen.error)
        assert.are.equal(1, seen.ready)
        assert.are.equal(23456, seen.value.port)
        assert.are.equal(0, seen.errors)
        assert.is_false(tostring(seen.error):find("private-diagnostic", 1, true) ~= nil)
        handle:stop()
        assert.is_true(support.await(function()
            return seen.exits == 1
        end))
        vim.env.PATH = old_path
        vim.fn.delete(directory, "rf")
    end)

    it("reports malformed startup and child exit once each", function()
        local directory = vim.fn.tempname()
        support.write_executable(
            directory,
            "python3",
            [[import sys
sys.stdin.buffer.readline()
sys.stdout.write('{"event":"ready","port":"bad"}\n'); sys.stdout.flush()
sys.stderr.write('private startup detail')
sys.stdin.buffer.read()
]]
        )
        local old_path = vim.env.PATH
        vim.env.PATH = directory .. ":" .. old_path
        local seen = { errors = 0, exits = 0 }
        process.start({ bufnr = 1, path = "/tmp/a.json", format = "json", display_name = "a.json" }, {
            on_ready = function()
                seen.ready = (seen.ready or 0) + 1
            end,
            on_error = function(message)
                seen.errors = seen.errors + 1
                seen.error = message
            end,
            on_exit = function()
                seen.exits = seen.exits + 1
            end,
        })
        assert.is_true(support.await(function()
            return seen.exits > 0
        end))
        assert.are.equal(1, seen.errors)
        assert.are.equal(1, seen.exits)
        assert.is_nil(seen.ready)
        assert.is_false(tostring(seen.error):find("private startup detail", 1, true) ~= nil)
        vim.env.PATH = old_path
        vim.fn.delete(directory, "rf")
    end)

    it("reaps a child that ignores SIGTERM after the two stop grace periods", function()
        local directory = vim.fn.tempname()
        support.write_executable(
            directory,
            "python3",
            [[import signal, sys, time
sys.stdin.buffer.readline()
sys.stdout.write('{"event":"ready","protocol":1,"port":23456,"token":"' + 'a' * 64 + '"}\n')
sys.stdout.flush()
signal.signal(signal.SIGTERM, signal.SIG_IGN)
time.sleep(30)
]]
        )
        local old_path = vim.env.PATH
        vim.env.PATH = directory .. ":" .. old_path
        local seen = { ready = 0, errors = 0, exits = 0 }
        local handle = process.start({ bufnr = 1, path = "/tmp/a.json", format = "json", display_name = "a.json" }, {
            on_ready = function()
                seen.ready = seen.ready + 1
            end,
            on_error = function(message)
                seen.errors = seen.errors + 1
                seen.error = message
            end,
            on_exit = function(code)
                seen.exits = seen.exits + 1
                seen.code = code
            end,
        })
        assert.is_true(support.await(function()
            return seen.ready > 0
        end, 2000))
        handle:stop()
        assert.is_true(support.await(function()
            return seen.exits == 1
        end, 3500))
        assert.are.equal(0, seen.errors)
        assert.are.equal(1, seen.exits)
        vim.env.PATH = old_path
    end)

    it("calls error and exit once when Python or packaged assets are missing", function()
        local directory = vim.fn.tempname()
        vim.fn.mkdir(directory, "p")
        local old_path = vim.env.PATH
        vim.env.PATH = directory
        local errors, exits = 0, 0
        process.start({ bufnr = 1, path = "/tmp/a.json", format = "json", display_name = "a.json" }, {
            on_ready = function() end,
            on_error = function()
                errors = errors + 1
            end,
            on_exit = function()
                exits = exits + 1
            end,
        })
        assert.are.equal(1, errors)
        assert.are.equal(1, exits)
        vim.env.PATH = old_path

        local manifest = vim.fn.getcwd() .. "/dist/manifest.json"
        local backup = manifest .. ".task6-test-backup"
        local moved, move_error = vim.uv.fs_rename(manifest, backup)
        assert.is_true(moved, tostring(move_error))
        local asset_errors, asset_exits = 0, 0
        process.start({ bufnr = 1, path = "/tmp/a.json", format = "json", display_name = "a.json" }, {
            on_ready = function() end,
            on_error = function()
                asset_errors = asset_errors + 1
            end,
            on_exit = function()
                asset_exits = asset_exits + 1
            end,
        })
        local restored, restore_error = vim.uv.fs_rename(backup, manifest)
        assert.is_true(restored, tostring(restore_error))
        assert.are.equal(1, asset_errors)
        assert.are.equal(1, asset_exits)
    end)

    it("reports a startup timeout after five seconds and waits for the child to exit", function()
        local directory = vim.fn.tempname()
        support.write_executable(
            directory,
            "python3",
            [[import sys, time
sys.stdin.buffer.readline()
time.sleep(30)
]]
        )
        local old_path = vim.env.PATH
        vim.env.PATH = directory .. ":" .. old_path
        local seen = { errors = 0, exits = 0 }
        process.start({ bufnr = 1, path = "/tmp/a.json", format = "json", display_name = "a.json" }, {
            on_ready = function() end,
            on_error = function(message)
                seen.errors = seen.errors + 1
                seen.error = message
            end,
            on_exit = function(code)
                seen.exits = seen.exits + 1
                seen.code = code
            end,
        })
        assert.is_true(support.await(function()
            return seen.errors == 1 and seen.exits == 1
        end, 8000))
        assert.are.equal("The preview server did not start within 5 seconds.", seen.error)
        assert.are.equal(1, seen.errors)
        assert.are.equal(1, seen.exits)
        vim.env.PATH = old_path
    end)

    it("reports jobstart failure through one error and one exit callback", function()
        local original_jobstart = vim.fn.jobstart
        vim.fn.jobstart = function()
            return -1
        end
        local errors, exits = 0, 0
        process.start({ bufnr = 1, path = "/tmp/a.json", format = "json", display_name = "a.json" }, {
            on_ready = function() end,
            on_error = function()
                errors = errors + 1
            end,
            on_exit = function()
                exits = exits + 1
            end,
        })
        vim.fn.jobstart = original_jobstart
        assert.are.equal(1, errors)
        assert.are.equal(1, exits)
    end)
end)
