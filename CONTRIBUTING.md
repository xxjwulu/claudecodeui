# Contributing to CloudCLI UI

Thanks for your interest in contributing to CloudCLI UI! Before you start, please take a moment to read through this guide.

## Before You Start

- **Search first.** Check [existing issues](https://github.com/siteboon/claudecodeui/issues) and [pull requests](https://github.com/siteboon/claudecodeui/pulls) to avoid duplicating work.
- **Discuss first** for new features. Open an [issue](https://github.com/siteboon/claudecodeui/issues/new) to discuss your idea before investing time in implementation. We may already have plans or opinions on how it should work.
- **Bug fixes are always welcome.** If you spot a bug, feel free to open a PR directly.

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/claudecodeui.git
   cd claudecodeui
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

   > **Windows + China network users:** `npm install` may fail on `better-sqlite3` because `prebuild-install` cannot reach `github.com/.../releases/download/...` and falls back to compiling from source (which requires Visual Studio C++ Build Tools). See [Troubleshooting: Windows / China Network](#troubleshooting-windows--china-network) below.

4. Start the development server:
   ```bash
   npm run dev
   ```
5. Create a branch for your changes:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Troubleshooting: Windows / China Network

### Symptom

`npm install` fails at `better-sqlite3` (or another native module) with:

```
prebuild-install warn install
gyp ERR! find VS You need to install the latest version of Visual Studio
gyp ERR! find VS including the "Desktop development with C++" workload.
```

### Root cause

The package's prebuilt binary lives on GitHub Releases. If GitHub Releases is unreachable from your network (common in mainland China), `prebuild-install` silently fails and `npm` falls back to compiling from source via `node-gyp`, which fails because no Visual Studio C++ toolchain is installed.

### Quick fix — one-liner

Pass the npmmirror binary mirror via an env var so `prebuild-install` downloads from a China mirror instead of GitHub:

```bash
npm_config_better_sqlite3_binary_host_mirror="https://registry.npmmirror.com/-/binary/better-sqlite3" npm install
```

### Reliable fix — staged install

If the one-liner still fails for other native modules, install in two stages:

```bash
# 1) Install all packages without running native build scripts
npm install --ignore-scripts --no-audit --no-fund

# 2) Pull the better-sqlite3 binary from the China mirror
cd node_modules/better-sqlite3
npm_config_better_sqlite3_binary_host_mirror="https://registry.npmmirror.com/-/binary/better-sqlite3" npx prebuild-install
cd ../..

# 3) Run the project's own postinstall (no-op on Windows, fixes macOS permissions)
node scripts/fix-node-pty.js
```

Notes:
- `bcrypt` and `node-pty` bundle their Windows prebuilds inside the package (`prebuilds/win32-x64/`), so no download is needed for them.
- `sharp` 0.34+ ships platform binaries as separate `@img/sharp-win32-x64` packages that are installed normally — no extra step required.

### Verifying native modules

After install, confirm each native module loads:

```bash
node -e "require('better-sqlite3'); require('bcrypt'); require('node-pty'); require('sharp'); console.log('all native modules OK')"
```

### Re-installing later

`npm install` only needs to be re-run when `package.json` changes (added/removed/updated dependencies). For everyday code changes, the Vite and tsx dev servers hot-reload automatically — no reinstall needed. When you do reinstall, remember to pass the `better-sqlite3` mirror env var as shown above.

## Project Structure

```
claudecodeui/
├── src/              # React frontend (Vite + Tailwind)
│   ├── components/   # UI components
│   ├── contexts/     # React context providers
│   ├── hooks/        # Custom React hooks
│   ├── i18n/         # Internationalization and translations
│   ├── lib/          # Shared frontend libraries
│   ├── types/        # TypeScript type definitions
│   └── utils/        # Frontend utilities
├── server/           # Express backend
│   ├── routes/       # API route handlers
│   ├── middleware/    # Express middleware
│   ├── database/     # SQLite database layer
│   └── tools/        # CLI tool integrations
├── shared/           # Code shared between client and server
└── public/           # Static assets, icons, PWA manifest
```

## Development Workflow

- `npm run dev` — Start both the frontend and backend in development mode
- `npm run build` — Create a production build
- `npm run server` — Start only the backend server
- `npm run client` — Start only the Vite dev server

## Making Changes

### Bug Fixes

- Reference the issue number in your PR if one exists
- Describe how to reproduce the bug in your PR description
- Add a screenshot or recording for visual bugs

### New Features

- Keep the scope focused — one feature per PR
- Include screenshots or recordings for UI changes

### Documentation

- Documentation improvements are always welcome
- Keep language clear and concise

## Commit Convention

We follow [Conventional Commits](https://conventionalcommits.org/) to generate release notes automatically. Every commit message should follow this format:

```
<type>(optional scope): <description>
```

Use imperative, present tense: "add feature" not "added feature" or "adds feature".

### Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `perf` | A performance improvement |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only |
| `style` | CSS, formatting, visual changes |
| `chore` | Maintenance, dependencies, config |
| `ci` | CI/CD pipeline changes |
| `test` | Adding or updating tests |
| `build` | Build system changes |

### Examples

```bash
feat: add conversation search
feat(i18n): add Japanese language support
fix: redirect unauthenticated users to login
fix(editor): syntax highlighting for .env files
perf: lazy load code editor component
refactor(chat): extract message list component
docs: update API configuration guide
```

### Breaking Changes

Add `!` after the type or include `BREAKING CHANGE:` in the commit footer:

```bash
feat!: redesign settings page layout
```

## Pull Requests

- Give your PR a clear, descriptive title following the commit convention above
- Fill in the PR description with what changed and why
- Link any related issues
- Include screenshots for UI changes
- Make sure the build passes (`npm run build`)
- Keep PRs focused — avoid unrelated changes

## Releases

Releases are managed by maintainers using [release-it](https://github.com/release-it/release-it) with the [conventional changelog plugin](https://github.com/release-it/conventional-changelog).

```bash
npm run release           # interactive (prompts for version bump)
npm run release -- patch  # patch release
npm run release -- minor  # minor release
```

This automatically:
- Bumps the version based on commit types (`feat` = minor, `fix` = patch)
- Generates categorized release notes
- Updates `CHANGELOG.md`
- Creates a git tag and GitHub Release
- Publishes to npm

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0-or-later License](LICENSE), including the additional terms specified in Section 7 of the LICENSE file.