local assert = require("luassert")
local support = require("tests.lua.support")
local target = require("jsoncrack.target")

describe("jsoncrack target resolution", function()
    after_each(support.cleanup)

    it("resolves a saved mixed-case YAML file without reading buffer contents", function()
        local contents = "saved: value\n"
        local bufnr, path = support.file_buffer(".yaml", contents, "日本語 space ' \" $(touch nope).YAML")
        vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { "unsaved: value" })
        local result
        target.resolve(bufnr, function(err, value)
            result = { err = err, value = value }
        end)

        assert.is_true(support.await(function()
            return result ~= nil
        end))
        assert.is_nil(result.err)
        assert.are.equal(vim.uv.fs_realpath(path), result.value.path)
        assert.are.equal("yaml", result.value.format)
        assert.are.equal("日本語 space ' \" $(touch nope).YAML", result.value.display_name)
        assert.is_true(result.value.modified)
    end)

    it("rejects unsaved files, URI buffers, nofile buffers, and unsupported extensions", function()
        local cases = {
            { name = "new-unsaved", path = nil, buftype = "", ext = nil },
            { name = "uri", path = "term://123:echo", buftype = "", ext = nil },
            { name = "nofile", path = nil, buftype = "nofile", ext = nil },
            { name = "unsupported", path = nil, buftype = "", ext = ".txt" },
        }
        for _, case in ipairs(cases) do
            local path = case.path
            if case.ext then
                path = support.make_file(case.ext, "data")
            end
            local bufnr = support.buffer(path)
            vim.api.nvim_set_option_value("buftype", case.buftype, { buf = bufnr })
            local result
            target.resolve(bufnr, function(err, value)
                result = { err = err, value = value }
            end)
            assert.is_true(
                support.await(function()
                    return result ~= nil
                end),
                case.name .. " did not complete"
            )
            assert.is_truthy(result.err, case.name .. " should be rejected")
            assert.is_nil(result.value, case.name .. " should not return a target")
        end
    end)

    it("resolves JSON paths containing shell syntax as literal filenames", function()
        local bufnr, path = support.file_buffer(".json", "{}", "quote ' 日本語 $() spaces.json")
        local result
        target.resolve(bufnr, function(err, value)
            result = { err = err, value = value }
        end)
        assert.is_true(support.await(function()
            return result ~= nil
        end))
        assert.is_nil(result.err)
        assert.are.equal(path, result.value.path)
        assert.are.equal("json", result.value.format)
    end)

    it("captures modified state after the asynchronous filesystem checks", function()
        local bufnr = support.file_buffer(".json", "{}")
        local result
        target.resolve(bufnr, function(err, value)
            result = { err = err, value = value }
        end)
        vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { "changed after resolution began" })
        assert.is_true(support.await(function()
            return result ~= nil
        end, 1000))
        assert.is_nil(result.err)
        assert.is_true(result.value.modified)
    end)
end)
