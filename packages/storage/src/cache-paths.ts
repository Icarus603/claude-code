/**
 * V7 §8.10 — cache path resolution for log/transcript/mcp-log dirs.
 *
 * Moved from src/utils/cachePaths.ts. Owned by storage because these
 * paths determine where transcripts, error logs, and MCP logs are
 * persisted on disk. Cache dir is per-project, derived from cwd.
 *
 * Host-provided deps:
 *   - cwdFn: returns process.cwd() (or a mocked value in tests)
 *   - djb2HashFn: fallback hash for long project names
 *
 * Both have sensible node-builtin defaults; installStorageBindings wires
 * richer implementations at startup.
 */

import envPaths from 'env-paths'
import { join } from 'path'

const paths = envPaths('claude-cli')

// ---------------------------------------------------------------------------
// Setter-based DI — keeps storage src/-free.
// ---------------------------------------------------------------------------

let _cwd: () => string = () => process.cwd()
let _djb2Hash: (s: string) => number = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return h >>> 0
}

export function setCwdFn(fn: () => string): void {
  _cwd = fn
}

export function setDjb2HashFn(fn: (s: string) => number): void {
  _djb2Hash = fn
}

// ---------------------------------------------------------------------------
// Local sanitizePath using djb2Hash — NOT the shared version from
// sessionStoragePortable.ts which uses Bun.hash (wyhash) when available.
// Cache directory names must remain stable across upgrades so existing
// cache data (error logs, MCP logs) is not orphaned.
// ---------------------------------------------------------------------------

const MAX_SANITIZED_LENGTH = 200

function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) return sanitized
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${Math.abs(_djb2Hash(name)).toString(36)}`
}

function getProjectDir(cwd: string): string {
  return sanitizePath(cwd)
}

export const CACHE_PATHS = {
  baseLogs: () => join(paths.cache, getProjectDir(_cwd())),
  errors: () => join(paths.cache, getProjectDir(_cwd()), 'errors'),
  messages: () => join(paths.cache, getProjectDir(_cwd()), 'messages'),
  mcpLogs: (serverName: string) =>
    join(
      paths.cache,
      getProjectDir(_cwd()),
      // Sanitize server name for Windows compatibility (colons are reserved for drive letters)
      `mcp-logs-${sanitizePath(serverName)}`,
    ),
}
