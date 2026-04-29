import { homedir } from 'os'

/**
 * Expands tilde (~) at the start of a path to the user's home directory.
 * Note: ~username expansion is not supported for security reasons.
 *
 * Lives in config (not permission) so config/plugin/_deps.ts can call it
 * statically — used to be in permission/pathValidation.ts and was lazy-
 * required to avoid the config → permission cycle.
 */
export function expandTilde(path: string): string {
  if (
    path === '~' ||
    path.startsWith('~/') ||
    (process.platform === 'win32' && path.startsWith('~\\'))
  ) {
    return homedir() + path.slice(1)
  }
  return path
}
