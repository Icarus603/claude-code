/**
 * V7 §8.5 — projectIsInGitRepo: synchronous git-repo presence check.
 *
 * Moved from src/utils/memory/versions.ts. Inlined the underlying
 * findGitRoot logic to keep memory Wave-2 leaf src/-free.
 *
 * For async git checks, host wires a richer impl via MemoryHostBindings.
 */

import { existsSync, statSync } from 'node:fs'
import { dirname, parse, resolve } from 'node:path'

/**
 * Walk parent dirs looking for a `.git` entry (file or dir).
 * Returns the directory containing `.git`, or null if none found.
 */
function findGitRoot(cwd: string): string | null {
  let current = resolve(cwd)
  const root = parse(current).root
  while (true) {
    const candidate = `${current}/.git`
    try {
      if (existsSync(candidate)) {
        // Could be a file (worktree pointer) or a dir — both indicate a git repo
        statSync(candidate)
        return current
      }
    } catch {
      // ignore stat errors
    }
    if (current === root) return null
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * Note: Used to check git repo status synchronously.
 * Walks the filesystem (no subprocess). Prefer async checks via
 * `MemoryHostBindings.getGithubRepo` or similar for production code.
 */
export function projectIsInGitRepo(cwd: string): boolean {
  return findGitRoot(cwd) !== null
}
