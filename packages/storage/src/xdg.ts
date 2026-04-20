/**
 * XDG Base Directory utilities for Claude CLI Native Installer
 *
 * Implements the XDG Base Directory specification for organizing
 * native installer components across appropriate system directories.
 *
 * @see https://specifications.freedesktop.org/basedir-spec/latest/
 */

import { homedir as osHomedir } from 'os'
import { join } from 'path'
import { getAllEnv, readEnv } from '@claude-code/config/env/utils'

type EnvLike = Record<string, string | undefined>

type XDGOptions = {
  env?: EnvLike
  homedir?: string
}

function resolveOptions(options?: XDGOptions): { env: EnvLike; home: string } {
  return {
    env: options?.env ?? getAllEnv(),
    home: options?.homedir ?? readEnv('HOME') ?? osHomedir(),
  }
}

/**
 * Get XDG state home directory
 * Default: ~/.local/state
 */
export function getXDGStateHome(options?: XDGOptions): string {
  const { env, home } = resolveOptions(options)
  return env.XDG_STATE_HOME ?? join(home, '.local', 'state')
}

/**
 * Get XDG cache home directory
 * Default: ~/.cache
 */
export function getXDGCacheHome(options?: XDGOptions): string {
  const { env, home } = resolveOptions(options)
  return env.XDG_CACHE_HOME ?? join(home, '.cache')
}

/**
 * Get XDG data home directory
 * Default: ~/.local/share
 */
export function getXDGDataHome(options?: XDGOptions): string {
  const { env, home } = resolveOptions(options)
  return env.XDG_DATA_HOME ?? join(home, '.local', 'share')
}

/**
 * Get user bin directory (not technically XDG but follows the convention)
 * Default: ~/.local/bin
 */
export function getUserBinDir(options?: XDGOptions): string {
  const { home } = resolveOptions(options)
  return join(home, '.local', 'bin')
}
