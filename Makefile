.PHONY: lint lint-lua lint-web lint-python test-lua test-python test-web test-renderer test-integration test-e2e test build verify-dist check

LUA_SOURCES := lua/jsoncrack plugin/jsoncrack.lua tests/lua tests/minimal_init.lua
TEST_FILE ?=

lint: lint-lua lint-web lint-python

lint-lua:
	stylua --check $(LUA_SOURCES)
	selene $(LUA_SOURCES)

lint-web:
	env -u NO_COLOR -u FORCE_COLOR npm --prefix web run typecheck

lint-python:
	python3 -m compileall -q server scripts tests
	env -u NO_COLOR -u FORCE_COLOR npm --prefix web run typecheck:python

test-lua:
	@if [ -n "$(TEST_FILE)" ]; then \
		nvim --headless --noplugin -u tests/minimal_init.lua -c "PlenaryBustedFile $(TEST_FILE)"; \
	else \
		nvim --headless --noplugin -u tests/minimal_init.lua -c "PlenaryBustedDirectory tests/lua/ { minimal_init = 'tests/minimal_init.lua' }"; \
	fi

test-python:
	python3 -m unittest discover -s tests/python -v

test-web:
	env -u NO_COLOR -u FORCE_COLOR npm --prefix web run test
	env -u NO_COLOR -u FORCE_COLOR node --test web/scripts/licenses.test.mjs

test-renderer:
	env -u NO_COLOR -u FORCE_COLOR npm --prefix web run test:renderer

test-integration:
	python3 -m unittest discover -s tests/integration -v

test-e2e:
	env -u NO_COLOR -u FORCE_COLOR npm --prefix web run test:e2e

build:
	env -u NO_COLOR -u FORCE_COLOR npm --prefix web run build

verify-dist: build
	python3 scripts/check_dist.py --check-tracked

test:
	$(MAKE) --no-print-directory test-python
	$(MAKE) --no-print-directory test-lua TEST_FILE=
	$(MAKE) --no-print-directory test-web
	$(MAKE) --no-print-directory test-renderer
	$(MAKE) --no-print-directory test-integration
	$(MAKE) --no-print-directory test-e2e

check:
	$(MAKE) --no-print-directory lint
	$(MAKE) --no-print-directory test
	$(MAKE) --no-print-directory verify-dist
