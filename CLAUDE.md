# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

CloudCLI UI (package name `@cloudcli-ai/cloudcli`) is a web + Electron UI that fronts multiple coding-agent CLIs: Claude Code, Cursor CLI, Codex, Gemini CLI, and OpenCode. The backend auto-discovers sessions from `~/.claude` (and equivalent dirs for other providers), serves them over HTTP + WebSocket, and lets the frontend drive the agents, edit files, run git, and manage MCP servers.

## Commands

```bash
npm run dev              # Concurrently: backend (tsx watch) + frontend (Vite). Use this for development.
npm run server:dev       # Backend only (tsx), reads server/tsconfig.json
npm run client           # Frontend only (Vite dev server)
npm run build            # = build:client (vite build -> dist/) + build:server (tsc + tsc-alias -> dist-server/)
npm run server           # Run compiled backend from dist-server/server/index.js
npm run desktop:dev      # Electron pointing at Vite dev server (ELECTRON_DEV_URL=http://127.0.0.1:5173)
npm run typecheck        # tsc --noEmit for BOTH frontend (tsconfig.json) and backend (server/tsconfig.json)
npm run lint             # eslint src/ server/
npm run lint:fix         # eslint --fix
```

### Tests

Tests use Node's built-in test runner (`node:test` + `node:assert`). There is **no `npm test` script** — invoke directly:

```bash
# All backend tests
node --test --test-reporter=spec --import tsx/esm "server/**/*.test.{js,ts}"

# Single file
node --test --import tsx/esm server/routes/tests/commands.test.js

# Single test by name filter
node --test --import tsx/esm --test-name-pattern="should clone" server/modules/projects/tests/project-clone.service.test.ts
```

Backend tests live next to the code under `server/**/tests/`. There are no frontend tests.

## Architecture

### Two compilation targets with the same `@/` alias

`@/` is ** deliberately remapped per target** — do not assume one global meaning:

- **Frontend** (`tsconfig.json`, Vite): `@/` → `src/`. JSX, DOM libs, Bundler moduleResolution.
- **Backend** (`server/tsconfig.json`, tsc + tsc-alias): `@/` → `server/` (inside compiled output, `server/`). NodeNext modules, `allowJs: true`, `checkJs: false` — the backend is JS being incrementally migrated to TS.

Build outputs are split: `dist/` for the client bundle, `dist-server/` for the server (with `server/` and `shared/` subdirs preserved so `@/` resolves correctly at runtime). The backend `rootDir` is the repo root, not `server/`, on purpose — see the comment in `server/tsconfig.json`.

### Backend layout

`server/index.js` is the Express + `ws` entry. It wires routes from `server/routes/*.js` and `server/modules/*/*.routes.ts`, plus middleware from `server/middleware/`. Notable pieces:

- **`server/modules/providers/`** — the multi-CLI abstraction. `provider.registry.ts` holds one `IProvider` instance per id (`claude`, `codex`, `cursor`, `gemini`, `opencode`). Each provider under `list/<id>/` exposes five facets: `auth`, `mcp`, `skills`, `sessions`, `sessionSynchronizer`. See `server/modules/providers/README.md` — it is the contract spec and **must be updated when provider wiring changes**.
- **`server/modules/database/`** — better-sqlite3 layer. `schema.ts` is the source of truth for tables; `repositories/` has per-table accessors (`projects.db.ts`, `sessions.db.ts`, `users.ts`, `api-keys.ts`, etc.). Migrations live in `migrations.ts`.
- **`server/modules/websocket/`** — chat run registry, connected clients, the WS server itself.
- **`server/claude-sdk.js`** — Claude integration uses `@anthropic-ai/claude-agent-sdk` directly (not a child process). Codex/Cursor/Gemini/OpenCode each have their own `server/<name>-cli.js` that spawn the CLI.
- **`server/utils/plugin-process-manager.js`** — plugins are separate Node processes started/stopped by the backend; each gets its own port.

### Frontend layout

React 18 SPA in `src/`, built by Vite. State is split between React contexts (`src/contexts/`) and a Zustand store (`src/stores/useSessionStore.ts`). Feature folders under `src/components/` (chat, file-tree, git-panel, shell, settings, plugins, mcp, task-master, etc.) each typically contain their own `hooks/`, `view/`, and `services/` subfolders.

ESLint enforces module boundaries via `eslint-plugin-boundaries` — respect the configured rules; don't reach across feature folders with deep imports.

### Auth

`server/middleware/auth.js` exposes `validateApiKey`, `authenticateToken` (JWT), and `authenticateWebSocket`. Credentials live in SQLite (`users`, `api_keys`, `user_credentials` tables). Onboarding state is tracked per-user via `has_completed_onboarding`.

### Environment

`.env.example` is the canonical reference. Key vars: `SERVER_PORT=3001`, `VITE_PORT=5173`, `HOST=0.0.0.0`, `DATABASE_PATH` (default `~/.cloudcli/auth.db`), `CLAUDE_CLI_PATH`. The server reads `.env` via `server/load-env.js`, which runs **before** other imports — keep it first in any new entry file. The Vite dev server proxies `/api`, `/ws`, `/shell`, `/plugin-ws` to the backend port.

## Conventions

- **Conventional Commits** are enforced via commitlint (see `CONTRIBUTING.md` for the full type list and examples).
- **i18n**: translation strings live in `src/i18n/`. When adding user-visible strings, add keys to all locale files — the build does not fail on missing keys, but `i18n` issues are tracked.
- **Native modules**: `better-sqlite3`, `bcrypt`, `node-pty`, `sharp` ship prebuilt binaries. On Windows + networks where GitHub Releases is unreachable, `npm install` fails at `better-sqlite3`; set `npm_config_better_sqlite3_binary_host_mirror=https://registry.npmmirror.com/-/binary/better-sqlite3` (or use the staged `--ignore-scripts` flow documented in `CONTRIBUTING.md`).
- **Path imports**: prefer `@/...` alias over relative imports in both frontend and backend.
