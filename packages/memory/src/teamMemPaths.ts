import { lstat, realpath } from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { getErrnoCode } from '@cc-app/utils/errors.js'
import { getAutoMemPath, isAutoMemoryEnabled } from './paths.js'

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathTraversalError'
  }
}

function sanitizePathKey(key: string): string {
  if (key.includes('\0')) {
    throw new PathTraversalError(`Null byte in path key: "${key}"`)
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(key)
  } catch {
    decoded = key
  }
  if (decoded !== key && (decoded.includes('..') || decoded.includes('/'))) {
    throw new PathTraversalError(`URL-encoded traversal in path key: "${key}"`)
  }
  const normalized = key.normalize('NFKC')
  if (
    normalized !== key &&
    (normalized.includes('..') ||
      normalized.includes('/') ||
      normalized.includes('\\') ||
      normalized.includes('\0'))
  ) {
    throw new PathTraversalError(
      `Unicode-normalized traversal in path key: "${key}"`,
    )
  }
  if (key.includes('\\')) {
    throw new PathTraversalError(`Backslash in path key: "${key}"`)
  }
  if (key.startsWith('/')) {
    throw new PathTraversalError(`Absolute path key: "${key}"`)
  }
  return key
}

export function isTeamMemoryEnabled(): boolean {
  if (!isAutoMemoryEnabled()) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_herring_clock', false)
}

export function getTeamMemPath(): string {
  return (join(getAutoMemPath(), 'team') + sep).normalize('NFC')
}

export function getTeamMemEntrypoint(): string {
  return join(getAutoMemPath(), 'team', 'MEMORY.md')
}

async function realpathDeepestExisting(absolutePath: string): Promise<string> {
  const tail: string[] = []
  let current = absolutePath
  for (
    let parent = dirname(current);
    current !== parent;
    parent = dirname(current)
  ) {
    try {
      const realCurrent = await realpath(current)
      return tail.length === 0
        ? realCurrent
        : join(realCurrent, ...tail.reverse())
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        try {
          const st = await lstat(current)
          if (st.isSymbolicLink()) {
            throw new PathTraversalError(
              `Dangling symlink detected (target does not exist): "${current}"`,
            )
          }
        } catch (lstatErr: unknown) {
          if (lstatErr instanceof PathTraversalError) {
            throw lstatErr
          }
        }
      } else if (code === 'ELOOP') {
        throw new PathTraversalError(
          `Symlink loop detected in path: "${current}"`,
        )
      } else if (code !== 'ENOTDIR' && code !== 'ENAMETOOLONG') {
        throw new PathTraversalError(
          `Cannot verify path containment (${code}): "${current}"`,
        )
      }
      tail.push(current.slice(parent.length + sep.length))
      current = parent
    }
  }
  return absolutePath
}

async function isRealPathWithinTeamDir(
  realCandidate: string,
): Promise<boolean> {
  let realTeamDir: string
  try {
    realTeamDir = await realpath(getTeamMemPath().replace(/[/\\]+$/, ''))
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return true
    }
    return false
  }
  if (realCandidate === realTeamDir) {
    return true
  }
  return realCandidate.startsWith(realTeamDir + sep)
}

export function isTeamMemPath(filePath: string): boolean {
  const resolvedPath = resolve(filePath)
  const teamDir = getTeamMemPath()
  return resolvedPath.startsWith(teamDir)
}

export async function validateTeamMemWritePath(
  filePath: string,
): Promise<string> {
  if (filePath.includes('\0')) {
    throw new PathTraversalError(`Null byte in path: "${filePath}"`)
  }
  const resolvedPath = resolve(filePath)
  const teamDir = getTeamMemPath()
  if (!resolvedPath.startsWith(teamDir)) {
    throw new PathTraversalError(
      `Path escapes team memory directory: "${filePath}"`,
    )
  }
  const realPath = await realpathDeepestExisting(resolvedPath)
  if (!(await isRealPathWithinTeamDir(realPath))) {
    throw new PathTraversalError(
      `Path escapes team memory directory via symlink: "${filePath}"`,
    )
  }
  return resolvedPath
}

export async function validateTeamMemKey(key: string): Promise<string> {
  const safeKey = sanitizePathKey(key)
  const filePath = join(getTeamMemPath(), safeKey)
  return validateTeamMemWritePath(filePath)
}
