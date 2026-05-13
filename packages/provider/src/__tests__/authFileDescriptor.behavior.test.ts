import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  CCR_SESSION_INGRESS_TOKEN_PATH,
} from '../authFileDescriptor.ts'

/**
 * Pin CCR file-descriptor token loading. Specifically the priority order
 * (FD env var FIRST, well-known file as fallback) — critical because:
 *
 * 1. Pipe FDs don't survive exec/tmux boundaries. Subprocesses spawned
 *    from a CCR session need the well-known file path or they break.
 * 2. Outside CCR there's no /home/claude — ENOENT is the EXPECTED outcome,
 *    must stay silent (not log noise).
 * 3. File mode invariants: 0o700 for dir, 0o600 for file — anything else
 *    would let other local users read OAuth tokens off disk.
 */
describe('CCR file-descriptor credential loading invariants', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'authFileDescriptor.ts'),
    'utf-8',
  )

  test('CCR_SESSION_INGRESS_TOKEN_PATH is exported (consumed by ingress-auth path)', () => {
    expect(CCR_SESSION_INGRESS_TOKEN_PATH).toBe(
      '/home/claude/.claude/remote/.session_ingress_token',
    )
  })

  test('Well-known paths: /home/claude/.claude/remote/ (NOT user home)', () => {
    // CCR-managed directory, not the user's $HOME. Pin so a refactor
    // that swaps to $HOME doesn't break the env-manager hand-off.
    expect(source).toMatch(
      /const CCR_TOKEN_DIR = '\/home\/claude\/\.claude\/remote'/,
    )
    expect(source).toMatch(/CCR_OAUTH_TOKEN_PATH = `\$\{CCR_TOKEN_DIR\}\/\.oauth_token`/)
    expect(source).toMatch(/CCR_API_KEY_PATH = `\$\{CCR_TOKEN_DIR\}\/\.api_key`/)
  })

  test('Persist mode 0o600 for token files (NOT 0o644 / 0o666)', () => {
    // Anything else (group/world readable) lets other local users tail
    // tokens off /home/claude/.claude/remote/. Pin to 0o600.
    expect(source).toMatch(/mode:\s*0o600/)
  })

  test('Persist mode 0o700 for CCR_TOKEN_DIR (only owner readable)', () => {
    expect(source).toMatch(/mode:\s*0o700/)
  })

  test('maybePersistTokenForSubprocesses gated on CLAUDE_CODE_REMOTE (no disk writes outside CCR)', () => {
    // Critical security: token-on-disk is only safe inside the CCR
    // container; outside, the user's terminal might use a different
    // sandboxing model and disk-persisted tokens would leak.
    expect(source).toMatch(
      /if\s*\(!isEnvTruthy\(readEnv\('CLAUDE_CODE_REMOTE'\)\)\)\s*\{?\s*\n?\s*return/,
    )
  })

  test('ENOENT on well-known file read → silent (expected outside CCR)', () => {
    // The path only exists in CCR. file-not-found is the normal outcome
    // everywhere else; logging at error level would create false alarm.
    expect(source).toMatch(/if\s*\(!isENOENT\(error\)\)\s*\{[\s\S]*?logForDebugging/)
  })

  test('Platform-specific FD path: /dev/fd on macOS/BSD, /proc/self/fd on Linux', () => {
    // Linux's /dev/fd is a symlink to /proc/self/fd, but using /dev/fd
    // on macOS is the correct (and only working) way. Pin so a
    // "consolidate to /dev/fd everywhere" refactor doesn't break Linux.
    expect(source).toMatch(
      /process\.platform === 'darwin' \|\| process\.platform === 'freebsd'\s*\n?\s*\?\s*`\/dev\/fd\/\$\{fd\}`\s*\n?\s*:\s*`\/proc\/self\/fd\/\$\{fd\}`/,
    )
  })

  test('FD priority: env var FIRST, well-known file as fallback (both directions)', () => {
    const fnStart = source.indexOf('function getCredentialFromFd')
    const fnSlice = source.slice(fnStart, fnStart + 3000)
    // No env var path → try well-known file (subprocess case)
    expect(fnSlice).toMatch(/if\s*\(!fdEnv\)\s*\{[\s\S]*?readTokenFromWellKnownFile/)
    // FD read failure → fall back to well-known file (ENXIO from inherited env)
    expect(fnSlice).toMatch(
      /catch\s*\(error\)\s*\{[\s\S]*?FD env var was set but read failed[\s\S]*?readTokenFromWellKnownFile/,
    )
  })

  test('Empty token treated as failure (not silently using empty string)', () => {
    // An empty FD content is a misconfig signal, not a legit token. Pin
    // the explicit null-return so we don't try to use "" as a Bearer.
    expect(source).toMatch(
      /if\s*\(!token\)\s*\{[\s\S]*?File descriptor contained empty[\s\S]*?return null/,
    )
  })

  test('Successful FD read persists to well-known file for subprocesses', () => {
    // The on-success persist is THE reason subprocesses inside CCR can
    // find the token. Drop this and tmux/shell subprocesses break.
    expect(source).toMatch(
      /maybePersistTokenForSubprocesses\(wellKnownPath, token, label\)/,
    )
  })
})
