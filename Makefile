.PHONY: lint-lua test-lua

LUA_SOURCES := lua/jsoncrack plugin/jsoncrack.lua tests/lua tests/minimal_init.lua
TEST_FILE ?=

lint-lua:
	stylua --check $(LUA_SOURCES)
	selene $(LUA_SOURCES)

test-lua:
	@if [ -n "$(TEST_FILE)" ]; then \
		nvim --headless --noplugin -u tests/minimal_init.lua -c "PlenaryBustedFile $(TEST_FILE)"; \
	else \
		nvim --headless --noplugin -u tests/minimal_init.lua -c "PlenaryBustedDirectory tests/lua/ { minimal_init = 'tests/minimal_init.lua' }"; \
	fi
