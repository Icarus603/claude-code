/**
 * Top-level main() body extracted from src/main.tsx per V7 §10.1.
 *
 * `src/main.tsx` retains only the module-load side effects (profiler
 * checkpoint, MDM/keychain prefetches, theme config wiring) — the actual
 * startup sequence lives here.
 */

import type { RuntimeHandles } from '@claude-code/app-host'

import { initializeWarningHandler } from '../../../../src/utils/warningHandler.js'
import { profileCheckpoint } from '../../../../src/utils/startupProfiler.js'
import {
  eagerLoadSettings,
} from '../../../../src/main/startup/settings.js'

import { resetCursor } from './bootstrap-utils.js'
import { detectRuntimeMode } from './detect-mode.js'
import {
  createPendingHandles,
  preprocessCliArgv,
  type PendingHandles,
} from './preprocess-argv.js'
import { runCliProgram } from './run-program.js'

/**
 * Install the shared process-level signal/exit handlers.
 * In print mode, print.ts registers its own SIGINT handler that aborts the
 * in-flight query and calls gracefulShutdown; skip here to avoid preempting
 * it with a synchronous process.exit().
 */
function installProcessHandlers(): void {
  // SECURITY: Prevent Windows from executing commands from current directory
  // This must be set before ANY command execution to prevent PATH hijacking attacks
  // See: https://docs.microsoft.com/en-us/windows/win32/api/processenv/nf-processenv-searchpathw
  process.env.NoDefaultCurrentDirectoryInExePath = '1'

  // Initialize warning handler early to catch warnings
  initializeWarningHandler()

  process.on('exit', () => {
    resetCursor()
  })
  process.on('SIGINT', () => {
    if (process.argv.includes('-p') || process.argv.includes('--print')) {
      return
    }
    process.exit(0)
  })
}

/**
 * Top-level orchestrator for Claude Code CLI startup.
 * Called from `main()` in src/main.tsx after module-load side effects.
 */
export async function runClaudeCode(runtimeHandles: RuntimeHandles): Promise<void> {
  profileCheckpoint('main_function_start')

  installProcessHandlers()
  profileCheckpoint('main_warning_handler_initialized')

  const pendings: PendingHandles = createPendingHandles()
  await preprocessCliArgv(pendings)

  detectRuntimeMode()

  profileCheckpoint('main_client_type_determined')

  // Parse and load settings flags early, before init()
  eagerLoadSettings()

  profileCheckpoint('main_before_run')

  await runCliProgram(runtimeHandles, pendings)
  profileCheckpoint('main_after_run')
}
