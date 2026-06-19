import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CLAUDE_COMMAND = 'claude';
const CLAUDE_SCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const CLAUDE_WRAPPER_SEGMENTS = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'] as const;
/**
 * Standard location of the JS launcher shipped by the npm package
 * `@anthropic-ai/claude-code`. When the native `claude.exe` is absent (i.e.
 * Claude Code was installed via `npm install -g` rather than the native
 * installer), the SDK still works if it is handed the `cli.js` path —
 * internally it detects the `.js` extension and spawns `node cli.js ...`.
 */
const CLAUDE_JS_LAUNCHER_SEGMENTS = ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js'] as const;

export type ResolveClaudeCodeExecutablePathDependencies = {
  execFileSync?: typeof execFileSync;
  existsSync?: typeof fs.existsSync;
  platform?: NodeJS.Platform;
  readFileSync?: typeof fs.readFileSync;
};

function getPathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isPathLike(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

function resolveClaudeWrapperBinary(
  wrapperPath: string,
  deps: Required<ResolveClaudeCodeExecutablePathDependencies>,
): string | null {
  const pathApi = getPathApi(deps.platform);
  const directCandidate = pathApi.resolve(pathApi.dirname(wrapperPath), ...CLAUDE_WRAPPER_SEGMENTS);

  if (deps.existsSync(directCandidate)) {
    return directCandidate;
  }

  let content: string;
  try {
    content = deps.readFileSync(wrapperPath, 'utf8');
  } catch {
    return null;
  }

  const matches = content.matchAll(/["']([^"'\\\r\n]*claude\.exe)["']/gi);
  for (const match of matches) {
    const rawTarget = match[1]
      .replace(/^\$basedir[\\/]/i, '')
      .replace(/^%dp0%[\\/]/i, '')
      .replace(/^%~dp0[\\/]/i, '');
    const normalizedTarget = rawTarget.replace(/[\\/]/g, pathApi.sep);
    const candidate = pathApi.isAbsolute(normalizedTarget)
      ? normalizedTarget
      : pathApi.resolve(pathApi.dirname(wrapperPath), normalizedTarget);

    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback: Claude Code installed via npm (no native binary). Hand the JS
  // launcher to the SDK — it detects the `.js` extension and runs it through
  // `node`. Try the standard npm layout first, then parse the wrapper for
  // any cli.js reference in case the package lives elsewhere.
  const jsLauncherCandidate = pathApi.resolve(
    pathApi.dirname(wrapperPath),
    ...CLAUDE_JS_LAUNCHER_SEGMENTS,
  );
  if (deps.existsSync(jsLauncherCandidate)) {
    return jsLauncherCandidate;
  }

  const jsMatches = content.matchAll(/["']([^"'\\\r\n]*@anthropic-ai[\\/][^"'\\\r\n]*cli\.js)["']/gi);
  for (const match of jsMatches) {
    const rawTarget = match[1]
      .replace(/^\$basedir[\\/]/i, '')
      .replace(/^%dp0%[\\/]/i, '')
      .replace(/^%~dp0[\\/]/i, '');
    const normalizedTarget = rawTarget.replace(/[\\/]/g, pathApi.sep);
    const candidate = pathApi.isAbsolute(normalizedTarget)
      ? normalizedTarget
      : pathApi.resolve(pathApi.dirname(wrapperPath), normalizedTarget);

    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveWindowsClaudeExecutablePath(
  configuredPath: string,
  deps: Required<ResolveClaudeCodeExecutablePathDependencies>,
): string {
  const pathApi = getPathApi(deps.platform);
  const extension = pathApi.extname(configuredPath).toLowerCase();
  const explicitPath = isPathLike(configuredPath) || pathApi.isAbsolute(configuredPath);

  if (CLAUDE_SCRIPT_EXTENSIONS.has(extension)) {
    return configuredPath;
  }

  if (explicitPath && extension === '.exe') {
    return configuredPath;
  }

  if (explicitPath) {
    return resolveClaudeWrapperBinary(configuredPath, deps) ?? configuredPath;
  }

  try {
    const stdout = deps.execFileSync('where.exe', [configuredPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const candidates = stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      if (pathApi.extname(candidate).toLowerCase() === '.exe') {
        return candidate;
      }
    }

    for (const candidate of candidates) {
      const resolved = resolveClaudeWrapperBinary(candidate, deps);
      if (resolved) {
        return resolved;
      }
    }
  } catch {
    return configuredPath;
  }

  return configuredPath;
}

/**
 * Well-known git-bash locations on Windows. Claude Code (>=2.x) requires
 * git-bash on Windows and refuses to start without one in PATH or pointed
 * to by CLAUDE_CODE_GIT_BASH_PATH. When git is installed on a non-C: drive
 * (or otherwise not on PATH for the spawned subprocess), the user would
 * otherwise see "Claude Code on Windows requires git-bash" and have to
 * configure the env var manually.
 */
const GIT_BASH_KNOWN_LOCATIONS = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
] as const;

export type ResolveGitBashPathDependencies =
  ResolveClaudeCodeExecutablePathDependencies;

/**
 * Resolves the git-bash binary path on Windows. Returns `null` on non-Windows
 * platforms or when no bash.exe can be found.
 *
 * Resolution order:
 *   1. The existing `CLAUDE_CODE_GIT_BASH_PATH` env var (already configured).
 *   2. `where.exe bash.exe` PATH lookup.
 *   3. Well-known install locations (covers git on a non-C: drive where the
 *      subprocess may not have the parent's PATH).
 */
export function resolveGitBashPath(
  dependencies: ResolveGitBashPathDependencies = {},
): string | null {
  const deps: Required<ResolveGitBashPathDependencies> = {
    execFileSync: dependencies.execFileSync ?? execFileSync,
    existsSync: dependencies.existsSync ?? fs.existsSync,
    platform: dependencies.platform ?? process.platform,
    readFileSync: dependencies.readFileSync ?? fs.readFileSync,
  };

  if (deps.platform !== 'win32') {
    return null;
  }

  const configured = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (configured && deps.existsSync(configured)) {
    return configured;
  }

  try {
    const stdout = deps.execFileSync('where.exe', ['bash.exe'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const pathCandidate = stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean);
    if (pathCandidate && deps.existsSync(pathCandidate)) {
      return pathCandidate;
    }
  } catch {
    // `where` returns non-zero when nothing is found; fall through to known locations.
  }

  for (const candidate of GIT_BASH_KNOWN_LOCATIONS) {
    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveClaudeCodeExecutablePath(
  configuredPath: string | undefined = process.env.CLAUDE_CLI_PATH,
  dependencies: ResolveClaudeCodeExecutablePathDependencies = {},
): string {
  const deps: Required<ResolveClaudeCodeExecutablePathDependencies> = {
    execFileSync: dependencies.execFileSync ?? execFileSync,
    existsSync: dependencies.existsSync ?? fs.existsSync,
    platform: dependencies.platform ?? process.platform,
    readFileSync: dependencies.readFileSync ?? fs.readFileSync,
  };

  const normalizedPath = stripWrappingQuotes(configuredPath || DEFAULT_CLAUDE_COMMAND);
  if (deps.platform !== 'win32') {
    return normalizedPath;
  }

  return resolveWindowsClaudeExecutablePath(normalizedPath, deps);
}
