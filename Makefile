# Run `make` (or `make help`) to see every command.

SERVER_PORT := 3333
CLIENT_PORT := 5173
NODE_MIN    := 22.12

# npm rewrites this file on every install, so it marks "dependencies are up to date"
DEPS_STAMP     := node_modules/.package-lock.json
PACKAGE_FILES  := package.json $(wildcard package-lock.json) shared/package.json server/package.json client/package.json

.DEFAULT_GOAL := help

.PHONY: help setup dev server client check build start clean reset check-node check-ports

help: ## Show this help
	@echo "Usage: make <command>"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "First time? Just run: make dev"

setup: check-node $(DEPS_STAMP) server/.env client/.env ## Install dependencies and create .env files

dev: setup check-ports ## Run server + client in development mode (hot reload)
	npm run dev

server: setup ## Run only the API server (watch mode)
	npm run dev -w server

client: setup ## Run only the web client (dev mode)
	npm run dev -w client

check: setup ## Type-check server and client
	npm run check

build: setup ## Build server and client for production
	npm run build

start: build check-ports ## Build, then run the production build locally
	npx concurrently -n server,client -c blue,magenta "npm run start -w server" "npm run preview -w client -- --port $(CLIENT_PORT) --strictPort"

clean: ## Remove build output
	rm -rf server/dist client/build client/.svelte-kit

reset: clean ## Remove build output and all node_modules (then run `make setup`)
	rm -rf node_modules server/node_modules client/node_modules shared/node_modules

# --- Internal targets -------------------------------------------------------

$(DEPS_STAMP): $(PACKAGE_FILES)
	npm install
	@touch $@

server/.env client/.env:
	cp $@.example $@
	@echo "Created $@ from $@.example"

check-node:
	@command -v node >/dev/null 2>&1 || { echo "Error: Node.js is not installed. Install Node $(NODE_MIN) or newer: https://nodejs.org"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "Error: npm is not installed."; exit 1; }
	@node -e "const [a, b] = process.versions.node.split('.').map(Number), [ma, mb] = '$(NODE_MIN)'.split('.').map(Number); \
	    if (a < ma || (a === ma && b < mb)) { console.error('Error: Node ' + process.versions.node + ' found, but $(NODE_MIN)+ is required.'); process.exit(1); }"

check-ports:
	@node -e "const net = require('node:net'); \
	    const check = (port) => new Promise((ok) => { const s = net.createServer().once('error', () => ok(port)).once('listening', () => s.close(() => ok(null))).listen(port); }); \
	    Promise.all([$(SERVER_PORT), $(CLIENT_PORT)].map(check)).then((busy) => { busy = busy.filter(Boolean); \
	        if (busy.length) { console.error('Error: port(s) ' + busy.join(', ') + ' already in use. Stop the other process (is the app already running?) and try again.'); process.exit(1); } });"
