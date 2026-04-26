// Leaf module: holds findGitRoot. Extracted from git.ts to break the
// gitFilesystem ↔ git cycle (gitFilesystem needed findGitRoot, git
// imports cache helpers from gitFilesystem).
//
// Pure function — no other storage dependencies.

import { statSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { logForDiagnosticsNoPII } from '@claude-code/local-observability/logging'
import { memoizeWithLRU } from '@claude-code/config/memoize.js'

const GIT_ROOT_NOT_FOUND = Symbol('git-root-not-found')

const findGitRootImpl = memoizeWithLRU(
  (startPath: string): string | typeof GIT_ROOT_NOT_FOUND => {
    const startTime = Date.now()
    logForDiagnosticsNoPII('info', 'find_git_root_started')

    let current = resolve(startPath)
    const root = current.substring(0, current.indexOf(sep) + 1) || sep
    let statCount = 0

    while (current !== root) {
      try {
        const gitPath = join(current, '.git')
        statCount++
        const stat = statSync(gitPath)
        if (stat.isDirectory() || stat.isFile()) {
          logForDiagnosticsNoPII('info', 'find_git_root_completed', {
            duration_ms: Date.now() - startTime,
            stat_count: statCount,
            found: true,
          })
          return current.normalize('NFC')
        }
      } catch {
        // .git doesn't exist at this level, continue up
      }
      const parent = dirname(current)
      if (parent === current) {
        break
      }
      current = parent
    }

    try {
      const gitPath = join(root, '.git')
      statCount++
      const stat = statSync(gitPath)
      if (stat.isDirectory() || stat.isFile()) {
        logForDiagnosticsNoPII('info', 'find_git_root_completed', {
          duration_ms: Date.now() - startTime,
          stat_count: statCount,
          found: true,
        })
        return root.normalize('NFC')
      }
    } catch {
      // .git doesn't exist at root
    }

    logForDiagnosticsNoPII('info', 'find_git_root_completed', {
      duration_ms: Date.now() - startTime,
      stat_count: statCount,
      found: false,
    })
    return GIT_ROOT_NOT_FOUND
  },
  path => path,
  50,
)

/**
 * Find the git root by walking up the directory tree.
 * Looks for a .git directory or file (worktrees/submodules use a file).
 * Returns the directory containing .git, or null if not found.
 */
export const findGitRoot: {
  (startPath: string): string | null
  cache: typeof findGitRootImpl.cache
} = (() => {
  function wrapper(startPath: string): string | null {
    const result = findGitRootImpl(startPath)
    return result === GIT_ROOT_NOT_FOUND ? null : result
  }
  wrapper.cache = findGitRootImpl.cache
  return wrapper
})()
