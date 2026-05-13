import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pins for `gracefulShutdown.ts` — handles process exit with
 * cleanup. Many invariants here are LIFE-OR-DEATH:
 *
 *  - Terminal-state cleanup must happen even if forceExit fails.
 *  - Failsafe timer must guarantee exit (5s minimum).
 *  - SIGHUP → exit 129 (128+1); SIGTERM → exit 143 (128+15) — UNIX convention.
 *  - Uncaught-exception loop detector: 10 within 5s → shutdown.
 *  - Print mode SKIPS the global SIGINT handler (print.ts owns it).
 *  - SessionEnd hooks bounded by getSessionEndHookTimeoutMs (settings).
 *  - signal-exit pin: no-op subscriber prevents Bun bug from nuking handlers.
 */
describe('gracefulShutdown — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'gracefulShutdown.ts'),
    'utf-8',
  )

  describe('Exit code conventions (UNIX 128+signal)', () => {
    test('SIGTERM → exit 143 (128 + 15)', () => {
      // Pin: standard UNIX convention. Init systems / supervisors read
      // this. Changing breaks tools that watch exit codes.
      expect(source).toMatch(
        /process\.on\('SIGTERM'[\s\S]+?gracefulShutdown\(143\)/,
      )
    })

    test('SIGHUP → exit 129 (128 + 1)', () => {
      expect(source).toMatch(
        /process\.on\('SIGHUP'[\s\S]+?gracefulShutdown\(129\)/,
      )
    })

    test('SIGINT → exit 0 (user-initiated, treated as clean)', () => {
      // Pin: ctrl+c is a clean exit. A regression to 130 (128+2) would
      // make CI scripts that distinguish "completed normally" from
      // "user cancelled" think every Ctrl+C is a failure.
      expect(source).toMatch(
        /process\.on\('SIGINT'[\s\S]+?gracefulShutdown\(0\)/,
      )
    })
  })

  describe('SIGINT print-mode skip', () => {
    test('SIGINT early-return when -p or --print in argv', () => {
      // Pin: print.ts registers its own SIGINT handler. The global one
      // must skip in print mode to avoid racing.
      expect(source).toMatch(
        /SIGINT[\s\S]+?if \(process\.argv\.includes\('-p'\) \|\| process\.argv\.includes\('--print'\)\) \{\s*\n?\s*return/,
      )
    })
  })

  describe('Failsafe exit timer', () => {
    test('failsafe budget = max(5000, sessionEndTimeoutMs + 3500)', () => {
      // Pin: a user-configured 10s hook budget gets 13.5s failsafe — NOT
      // truncated by the 5s minimum. Reverse regression risk: hardcoding
      // 5000 would silently truncate user-set hook budgets.
      expect(source).toMatch(
        /Math\.max\(5000, sessionEndTimeoutMs \+ 3500\)/,
      )
    })

    test('failsafe timer.unref() — doesn\'t keep event loop alive', () => {
      expect(source).toMatch(/failsafeTimer\.unref\(\)/)
    })

    test('failsafe action: cleanupTerminalModes + printResumeHint + forceExit', () => {
      // Pin: the three steps in this exact order. Terminal first
      // (otherwise resume hint hits alt screen), forceExit last.
      expect(source).toMatch(
        /setTimeout\(\s*\n?\s*code => \{\s*\n?\s*cleanupTerminalModes\(\)\s*\n?\s*printResumeHint\(\)\s*\n?\s*forceExit\(code\)/,
      )
    })
  })

  describe('Cleanup timeout (2000ms)', () => {
    test('runCleanupFunctions raced against 2-second timeout', () => {
      // Pin: 2s cap on cleanup. Longer cleanup hangs the exit; shorter
      // truncates legitimate work.
      expect(source).toMatch(
        /setTimeout\([\s\S]{0,200}?CleanupTimeoutError[\s\S]{0,100}?2000/,
      )
    })

    test('CleanupTimeoutError class declared (NOT inline string)', () => {
      // Pin: typed error so test can detect timeout vs other errors.
      expect(source).toMatch(/class CleanupTimeoutError extends Error/)
    })
  })

  describe('Uncaught-exception loop detector', () => {
    test('EXCEPTION_LOOP_WINDOW_MS = 5_000 (5 second sliding window)', () => {
      // Pin: aligned with ant v2.1.131 (2821.js H38=5000).
      expect(source).toMatch(/EXCEPTION_LOOP_WINDOW_MS = 5_000/)
    })

    test('EXCEPTION_LOOP_THRESHOLD = 10 (10 exceptions in window)', () => {
      // Pin: aligned with ant v2.1.131 fo1=10.
      expect(source).toMatch(/EXCEPTION_LOOP_THRESHOLD = 10/)
    })

    test('telemetry tengu_uncaught_exception (per-exception)', () => {
      expect(source).toMatch(/'tengu_uncaught_exception'/)
    })

    test('telemetry tengu_uncaught_exception_loop (when threshold tripped)', () => {
      expect(source).toMatch(/'tengu_uncaught_exception_loop'/)
    })

    test('errorMessageHash = sha256.slice(0, 16) (matches ant al_(H).error_message_hash)', () => {
      // Pin: hash format. Dashboard groups on this exact form.
      expect(source).toMatch(
        /createHash\('sha256'\)\s*\n?\s*\.update\(error\.message \|\| ''\)\s*\n?\s*\.digest\('hex'\)\s*\n?\s*\.slice\(0, 16\)/,
      )
    })

    test('loop shutdown fires gracefulShutdown(1, "fatal")', () => {
      expect(source).toMatch(/gracefulShutdown\(1, 'fatal'\)/)
    })

    test('loopShutdownFired guard prevents repeat shutdown calls', () => {
      // Pin: monotonic flag — second trigger is no-op.
      expect(source).toMatch(
        /if \([\s\S]{0,80}?exceptionTimestamps\.length >= EXCEPTION_LOOP_THRESHOLD &&[\s\S]{0,80}?!loopShutdownFired\s*\n?\s*\) \{\s*\n?\s*loopShutdownFired = true/,
      )
    })
  })

  describe('signal-exit v4 Bun bug workaround', () => {
    test('onExit no-op subscriber registered (pins v4 emitter count > 0)', () => {
      // Pin: documented Bun bug. Removing onExit(() => {}) lets v4
      // unload, which calls removeListener which nukes kernel sigaction.
      expect(source).toMatch(/onExit\(\(\) => \{\}\)/)
    })
  })

  describe('Terminal mode cleanup', () => {
    test('cleanupTerminalModes early-returns when stdout not a TTY', () => {
      // Pin: avoid writing escape sequences to a pipe.
      expect(source).toMatch(
        /cleanupTerminalModes\(\): void \{\s*\n?\s*if \(!process\.stdout\.isTTY\) \{\s*\n?\s*return/,
      )
    })

    test('DISABLE_MOUSE_TRACKING fired FIRST (before alt-screen exit)', () => {
      const fn = source.match(
        /function cleanupTerminalModes[\s\S]+?\n\}/,
      )?.[0]
      expect(fn).toBeTruthy()
      const mouseIdx = fn!.indexOf('DISABLE_MOUSE_TRACKING')
      const altIdx = fn!.indexOf('EXIT_ALT_SCREEN')
      // mouse tracking first
      expect(mouseIdx).toBeLessThan(altIdx)
    })

    test('CLAUDE_CODE_DISABLE_TERMINAL_TITLE → skip clearing title', () => {
      // Pin: if user disabled title changes, don't clear it on exit.
      expect(source).toMatch(
        /if \(!isEnvTruthy\(process\.env\.CLAUDE_CODE_DISABLE_TERMINAL_TITLE\)\)/,
      )
    })

    test('Windows path: process.title = "" (no escape sequence)', () => {
      // Pin: Windows doesn't honor CLEAR_TERMINAL_TITLE escape; use the
      // Node.js process.title setter instead.
      expect(source).toMatch(
        /if \(process\.platform === 'win32'\) \{\s*\n?\s*process\.title = ''/,
      )
    })
  })

  describe('Resume-hint behavior', () => {
    test('resumeHintPrinted guard prevents double-print', () => {
      // Pin: failsafe timer may call printResumeHint a second time after
      // normal shutdown. Once-only.
      expect(source).toMatch(
        /if \(resumeHintPrinted\) \{\s*\n?\s*return\s*\n?\s*\}/,
      )
    })

    test('shown ONLY when isTTY && interactive && !persistenceDisabled', () => {
      // Pin: 3-way gate. A regression that drops any guard would print
      // resume hints in non-interactive / piped sessions.
      expect(source).toMatch(
        /process\.stdout\.isTTY &&[\s\S]+?getIsInteractive\(\) &&[\s\S]+?!isSessionPersistenceDisabled\(\)/,
      )
    })

    test('session ID existence check (skips for transient sessions)', () => {
      // Pin: subcommands like `claude update` don't have a session file.
      // Resume hint must skip them.
      expect(source).toMatch(
        /if \(!sessionIdExists\(sessionId\)\) \{\s*\n?\s*return\s*\n?\s*\}/,
      )
    })
  })

  describe('Force exit fallback', () => {
    test('SIGKILL fallback when process.exit() throws EIO', () => {
      // Pin: dead TTY → process.exit throws → SIGKILL.
      expect(source).toMatch(/process\.kill\(process\.pid, 'SIGKILL'\)/)
    })

    test('test mode re-throws (NOT SIGKILL) so test can detect mock', () => {
      // Pin: NODE_ENV==='test' path. Otherwise tests can't intercept
      // process.exit mock.
      expect(source).toMatch(
        /if \(\(process\.env\.NODE_ENV as string\) === 'test'\) \{\s*\n?\s*throw e/,
      )
    })
  })

  describe('Shutdown idempotency', () => {
    test('shutdownInProgress flag prevents recursive calls', () => {
      // Pin: critical. Without this, a SIGINT during cleanup would
      // double-fire and could deadlock.
      expect(source).toMatch(
        /if \(shutdownInProgress\) \{\s*\n?\s*return\s*\n?\s*\}\s*\n?\s*shutdownInProgress = true/,
      )
    })
  })

  describe('Orphan detection (macOS TTY revocation)', () => {
    test('30-second interval check via process.stdout.writable', () => {
      // Pin: macOS revokes TTY without SIGHUP — we poll instead.
      expect(source).toMatch(/30_000/) // 30 second interval
      expect(source).toMatch(
        /!process\.stdout\.writable \|\| !process\.stdin\.readable/,
      )
    })

    test('orphan detection only on TTY stdin (not piped)', () => {
      expect(source).toMatch(
        /if \(process\.stdin\.isTTY\) \{\s*\n?\s*orphanCheckInterval = setInterval/,
      )
    })

    test('orphan check unref\'d (doesn\'t keep event loop alive)', () => {
      expect(source).toMatch(/orphanCheckInterval\.unref\(\)/)
    })

    test('orphan exits with code 129 (SIGHUP equivalent)', () => {
      // Pin: orphan == lost terminal == SIGHUP semantics.
      expect(source).toMatch(
        /orphan_detected[\s\S]+?gracefulShutdown\(129\)/,
      )
    })
  })

  describe('Cache eviction hint telemetry', () => {
    test('emits tengu_cache_eviction_hint with last request ID', () => {
      // Pin: signals inference cache invalidation. A regression that
      // drops the event would let cache go stale.
      expect(source).toMatch(/'tengu_cache_eviction_hint'/)
      expect(source).toMatch(/last_request_id:/)
    })

    test('skipped when no lastRequestId (e.g., subagent never made a request)', () => {
      // Pin: gate on `if (lastRequestId)`.
      expect(source).toMatch(/if \(lastRequestId\) \{[\s\S]+?logEvent\('tengu_cache_eviction_hint'/)
    })
  })
})
