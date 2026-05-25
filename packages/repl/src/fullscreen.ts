import { spawnSync } from 'child_process'
import { getIsInteractive } from '@claude-code/app-host/bootstrap/state.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '@claude-code/config/env/utils'
import { getInitialSettings } from '@claude-code/config/settings'
import { execFileNoThrow } from '@claude-code/shell/execFileNoThrow.js'

let loggedTmuxCcDisable = false
let loggedWinSshDisable = false
let checkedTmuxMouseHint = false

/**
 * True on Windows when the session is over SSH. ConPTY re-renders the screen
 * buffer on its own, which double-paints an alt-screen application — so
 * fullscreen must be disabled. 1:1 port of ant `k$8` (2.1.150 2218.js:42).
 */
function isWindowsOverSSH(): boolean {
  if (process.platform !== 'win32') return false
  return Boolean(
    process.env.SSH_CONNECTION ||
      process.env.SSH_CLIENT ||
      process.env.SSH_TTY,
  )
}

/**
 * Cached result from `tmux display-message -p '#{client_control_mode}'`.
 * undefined = not yet queried (or probe failed) — env heuristic stays authoritative.
 */
let tmuxControlModeProbed: boolean | undefined

/**
 * Env-var heuristic for iTerm2's tmux integration mode (`tmux -CC` / `tmux -2CC`).
 *
 * In `-CC` mode, iTerm2 renders tmux panes as native splits — tmux runs
 * as a server (TMUX is set) but iTerm2 is the actual terminal emulator
 * for each pane, so TERM_PROGRAM stays `iTerm.app` and TERM is iTerm2's
 * default (xterm-*). Contrast with regular tmux-inside-iTerm2, where tmux
 * overwrites TERM_PROGRAM to `tmux` and sets TERM to screen-* or tmux-*.
 *
 * This heuristic has known holes (SSH often doesn't propagate TERM_PROGRAM;
 * .tmux.conf can override TERM) — probeTmuxControlModeSync() is the
 * authoritative backstop. Kept as a zero-subprocess fast path.
 */
function isTmuxControlModeEnvHeuristic(): boolean {
  if (!process.env.TMUX) return false
  if (process.env.TERM_PROGRAM !== 'iTerm.app') return false
  // Belt-and-suspenders: in regular tmux TERM is screen-* or tmux-*;
  // in -CC mode iTerm2 sets its own TERM (xterm-*).
  const term = process.env.TERM ?? ''
  return !term.startsWith('screen') && !term.startsWith('tmux')
}

/**
 * Sync one-shot probe: asks tmux directly whether this client is in control
 * mode via `#{client_control_mode}`. Runs on first isTmuxControlMode() call
 * when the env heuristic can't decide; result is cached.
 *
 * Sync (spawnSync) because the answer gates whether we enter fullscreen — an
 * async probe raced against React render and lost: coder-tmux (ssh → tmux -CC
 * on a remote box) doesn't propagate TERM_PROGRAM, so the env heuristic missed,
 * and by the time the async probe resolved we'd already entered alt-screen with
 * mouse tracking enabled. Mouse wheel is dead in iTerm2's -CC integration, so
 * users couldn't scroll at all.
 *
 * Cost: one ~5ms subprocess, only when $TMUX is set AND $TERM_PROGRAM is unset
 * (the SSH-into-tmux case). Local iTerm2 -CC and non-tmux paths skip the spawn.
 *
 * The TMUX env check MUST come first — without it, display-message would
 * query whatever tmux server happens to be running rather than our client.
 */
function probeTmuxControlModeSync(): void {
  // Seed cache with heuristic result so early returns below don't leave it
  // undefined — isTmuxControlMode() is called 15+ times per render, and an
  // undefined cache would re-enter this function (re-spawning tmux in the
  // failure case) on every call.
  tmuxControlModeProbed = isTmuxControlModeEnvHeuristic()
  if (tmuxControlModeProbed) return
  if (!process.env.TMUX) return
  // Only probe when iTerm might be involved: TERM_PROGRAM is iTerm.app
  // (covered above) or not set (SSH often doesn't propagate it). When
  // TERM_PROGRAM is explicitly a non-iTerm terminal, skip — tmux -CC is
  // an iTerm-only feature, so the subprocess would be wasted.
  if (process.env.TERM_PROGRAM) return
  let result
  try {
    result = spawnSync(
      'tmux',
      ['display-message', '-p', '#{client_control_mode}'],
      { encoding: 'utf8', timeout: 2000 },
    )
  } catch {
    // spawnSync can throw on some platforms (e.g. ENOENT on Windows if tmux
    // is absent and the runtime surfaces it as an exception rather than in
    // result.error). Treat the same as a non-zero exit.
    return
  }
  // Non-zero exit / spawn error: tmux too old (format var added in 2.4) or
  // unavailable. Keep the heuristic result cached.
  if (result.status !== 0) return
  tmuxControlModeProbed = result.stdout.trim() === '1'
}

/**
 * True when running under `tmux -CC` (iTerm2 integration mode).
 *
 * The alt-screen / mouse-tracking path in fullscreen mode is unrecoverable
 * in -CC mode (double-click corrupts terminal state; mouse wheel is dead),
 * so callers auto-disable fullscreen.
 *
 * Lazily probes tmux on first call when the env heuristic can't decide.
 */
export function isTmuxControlMode(): boolean {
  if (tmuxControlModeProbed === undefined) probeTmuxControlModeSync()
  return tmuxControlModeProbed ?? false
}

export function _resetTmuxControlModeProbeForTesting(): void {
  tmuxControlModeProbed = undefined
  loggedTmuxCcDisable = false
  loggedWinSshDisable = false
}

/**
 * 1:1 port of ant's fullscreen-decision function `j9` (2.1.150 2218.js:51-80).
 *
 * The alt-screen ("fullscreen") renderer is ant's BLESSED path: full repaint
 * every frame, virtualized scrollback, flicker-free. The main-screen renderer
 * is what ant's own /tui description (0680.js:653) calls the "classic" one —
 * it uses DIFFERENTIAL rendering (log-update diffs the previous frame and only
 * repaints changed cells, parking the cursor with relative moves). That diff
 * path has an unfixed tear: when content overflows the viewport, a changed row
 * above the viewport-top threshold `P` is silently skipped (2344.js:129 →
 * `return;` with no recovery), so the input box border tears, the right half
 * goes blank, and the cursor drifts below the footer. ant never fixed that
 * bug — instead it ships all its anti-tear engineering (probeExternalClear's
 * 200ms recovery poll, bg-worker forced fullscreen, ConPTY full-repaint) ONLY
 * on the alt-screen path, and rolls fullscreen out to everyone via GrowthBook
 * gates (`tengu_pewter_brook` / `tengu_amber_creek`).
 *
 * ant's `j9` has NO `USER_TYPE === 'ant'` check — that gate was a ccb-only
 * invention that locked non-ant operators onto the legacy, tearing renderer.
 * ccb is solo-maintained with no GrowthBook server, so the local default is
 * fullscreen (the rolled-out state), matching ant's intent. Resolution order:
 *   1. Background session (SESSION_KIND === 'bg') — always fullscreen; the
 *      `ccb attach` pipeline (alt-screen handoff, FRAME_CLEAR boundary,
 *      BSU/ESU wrap in attachClient.ts) only works when the worker is in
 *      alt-screen. ant 2218.js:53.
 *   2. Explicit opt-out — NO_FLICKER falsy OR DISABLE_ALTERNATE_SCREEN truthy.
 *      ant `V$8` (2218.js:46).
 *   3. NO_FLICKER truthy — explicit opt-in. ant 2218.js:55.
 *   4. tmux -CC — alt-screen + mouse tracking corrupts terminal state there.
 *      ant `$i` (2218.js:56-63).
 *   5. Windows over SSH — ConPTY re-rendering breaks alt-screen. ant `k$8`
 *      (2218.js:64-71).
 *   6. settings.tui ('fullscreen' / 'default') — persistent /tui choice.
 *      ant 2218.js:72-77.
 *   7. Default: fullscreen (ant's GrowthBook-rolled-out state; 2218.js:78-79).
 */
export function isFullscreenEnvEnabled(): boolean {
  // 1. Background workers are always fullscreen — the attach pipeline requires
  //    alt-screen. ant `j9` short-circuits here (2218.js:53) ahead of its own
  //    opt-out for exactly this reason.
  if (process.env.CLAUDE_CODE_SESSION_KIND === 'bg') return true
  // 2. Explicit opt-out (ant V$8): NO_FLICKER set falsy OR DISABLE_ALTERNATE_SCREEN
  //    set truthy. The DISABLE_ALTERNATE_SCREEN arm was missing in ccb.
  if (
    isEnvDefinedFalsy(process.env.CLAUDE_CODE_NO_FLICKER) ||
    isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN)
  ) {
    return false
  }
  // 3. Explicit opt-in (escape hatch).
  if (isEnvTruthy(process.env.CLAUDE_CODE_NO_FLICKER)) return true
  // 4. Auto-disable under tmux -CC: alt-screen + mouse tracking corrupts
  //    terminal state on double-click and mouse wheel is dead.
  if (isTmuxControlMode()) {
    if (!loggedTmuxCcDisable) {
      loggedTmuxCcDisable = true
      logForDebugging(
        'fullscreen disabled: tmux -CC (iTerm2 integration mode) detected · set CLAUDE_CODE_NO_FLICKER=1 to override',
      )
    }
    return false
  }
  // 5. Auto-disable on Windows over SSH: ConPTY re-renders the screen on its
  //    own, which double-paints an alt-screen app. ant `k$8` (2218.js:64).
  if (isWindowsOverSSH()) {
    if (!loggedWinSshDisable) {
      loggedWinSshDisable = true
      logForDebugging(
        'fullscreen disabled: Windows over SSH (ConPTY re-rendering) detected · set CLAUDE_CODE_NO_FLICKER=1 to override',
      )
    }
    return false
  }
  // 6. Persistent user choice via /tui.
  const tuiSetting = getInitialSettings().tui
  if (tuiSetting === 'fullscreen') return true
  if (tuiSetting === 'default') return false
  // 7. Default: fullscreen. ant's final fallback is the GrowthBook gate
  //    tengu_pewter_brook, which in the rolled-out state is on; ccb has no
  //    GrowthBook server, so the local default IS the rolled-out value.
  return true
}

/**
 * Whether fullscreen mode should enable SGR mouse tracking (DEC 1000/1002/1006).
 * Set CLAUDE_CODE_DISABLE_MOUSE=1 to keep alt-screen + virtualized scroll
 * (keyboard PgUp/PgDn/Ctrl+Home/End still work) but skip mouse capture,
 * so tmux/kitty/terminal-native copy-on-select keeps working.
 *
 * Compare with CLAUDE_CODE_NO_FLICKER=0 which is all-or-nothing — it also
 * disables alt-screen and virtualized scrollback.
 */
export function isMouseTrackingEnabled(): boolean {
  return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_MOUSE)
}

/**
 * Whether mouse click handling is disabled (clicks/drags ignored, wheel still
 * works). Set CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1 to prevent accidental clicks
 * from triggering cursor positioning, text selection, or message expansion.
 *
 * Fullscreen-specific — only reachable when CLAUDE_CODE_NO_FLICKER is active.
 */
export function isMouseClicksDisabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_MOUSE_CLICKS)
}

/**
 * True when the fullscreen alt-screen layout is actually rendering —
 * requires an interactive REPL session AND the env var not explicitly
 * set falsy. Headless paths (--print, SDK, in-process teammates) never
 * enter fullscreen, so features that depend on alt-screen re-rendering
 * should gate on this.
 */
export function isFullscreenActive(): boolean {
  return getIsInteractive() && isFullscreenEnvEnabled()
}

/**
 * One-time hint for tmux users in fullscreen with `mouse off`.
 *
 * tmux's `mouse` option is session-scoped by design — there is no
 * pane-level equivalent. We used to `tmux set mouse on` when entering
 * alt-screen so wheel scrolling worked, but that changed mouse behavior
 * for every sibling pane (vim, less, shell) and leaked on kill-pane or
 * when multiple CC instances raced on restore. Now we leave tmux state
 * alone — same as vim/less/htop — and just tell the user their options.
 *
 * Fire-and-forget from REPL startup. Returns the hint text once per
 * session if TMUX is set, fullscreen is active, and tmux's current
 * `mouse` option is off; null otherwise.
 */
export async function maybeGetTmuxMouseHint(): Promise<string | null> {
  if (!process.env.TMUX) return null
  // tmux -CC auto-disables fullscreen above, but belt-and-suspenders.
  if (!isFullscreenActive() || isTmuxControlMode()) return null
  if (checkedTmuxMouseHint) return null
  checkedTmuxMouseHint = true
  // -A includes inherited values: `show -v mouse` returns empty when the
  // option is set globally (`set -g mouse on` in .tmux.conf) but not at
  // session level — which is the common case. -A gives the effective value.
  const { stdout, code } = await execFileNoThrow(
    'tmux',
    ['show', '-Av', 'mouse'],
    { useCwd: false, timeout: 2000 },
  )
  if (code !== 0 || stdout.trim() === 'on') return null
  return "tmux detected · scroll with PgUp/PgDn · or add 'set -g mouse on' to ~/.tmux.conf for wheel scroll"
}

/** Test-only: reset module-level once-per-session flags. */
export function _resetForTesting(): void {
  loggedTmuxCcDisable = false
  loggedWinSshDisable = false
  checkedTmuxMouseHint = false
}
