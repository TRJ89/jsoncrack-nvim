if vim.g.loaded_jsoncrack_nvim then
    return
end
vim.g.loaded_jsoncrack_nvim = true

vim.api.nvim_create_user_command("JsonCrackPreviewToggle", function()
    require("jsoncrack").toggle()
end, { desc = "Toggle the JSON Crack preview" })

vim.api.nvim_create_user_command("JsonCrackPreviewOpen", function()
    require("jsoncrack").open()
end, { desc = "Open the JSON Crack preview" })

vim.api.nvim_create_user_command("JsonCrackPreviewStop", function()
    require("jsoncrack").stop()
end, { desc = "Stop the JSON Crack preview" })
