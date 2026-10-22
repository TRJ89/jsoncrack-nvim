.PHONY: lint-lua test-lua test-python test-web test-renderer test-integration test-e2e test

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

test-python:
	python3 -m unittest discover -s tests/python -v

test-web:
	npm --prefix web run test

test-renderer:
	npm --prefix web run test:renderer

test-integration:
	python3 -m unittest discover -s tests/integration -v

test-e2e:
	npm --prefix web run test:e2e

test:
	$(MAKE) --no-print-directory test-python
	$(MAKE) --no-print-directory test-lua TEST_FILE=
	$(MAKE) --no-print-directory test-web
	$(MAKE) --no-print-directory test-renderer
	$(MAKE) --no-print-directory test-integration
	$(MAKE) --no-print-directory test-e2e
