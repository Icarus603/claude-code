/**
 * `/goal` command — port of ant v2.1.136 4691.js (cu8 module).
 *
 * Two flavours, both exposed via the same `goal` name:
 *   - TZ3 (local-jsx) — interactive REPL: shows status / clear / set
 *     via a `LocalJSXCommand` (`immediate:true` so it doesn't go through
 *     the prompt input pipeline).
 *   - AZ3 (local) — non-interactive / remote-mode dispatch: returns a
 *     `LocalCommandResult`. `isHidden` is dynamic (true unless non-
 *     interactive); `isEnabled` requires the feature flag AND either
 *     non-interactive OR remote workspace. ant `thinClientDispatch` is
 *     `"post-text"` — ccb's slash dispatcher always posts text already,
 *     so the flag is implicit.
 *
 * Both gate on the `tengu_maple_tide` feature flag via
 * `isGoalCommandEnabled()`. Default-off; flipping the flag activates the
 * command without re-porting.
 */
import {
  isGoalCommandEnabled,
} from '@claude-code/agent/goalStopHook.js'
import {
  getIsNonInteractiveSession,
  getIsRemoteMode,
} from '@claude-code/app-host/bootstrap/state.js'
import type { Command } from '../../runtime.js'

/** Re-export so consumers that imported through index keep working. */
export { GOAL_CONDITION_MAX_LENGTH } from '@claude-code/agent/goalStopHook.js'

const goalJsxCommand: Command = {
  type: 'local-jsx',
  name: 'goal',
  description: 'Set a goal — keep working until the condition is met',
  argumentHint: '[<condition> | clear]',
  immediate: true,
  isEnabled: () => isGoalCommandEnabled(),
  load: () => import('./goal.js'),
}

export default goalJsxCommand

export const goalLocalCommand: Command = {
  type: 'local',
  name: 'goal',
  supportsNonInteractive: true,
  description: 'Set a goal — keep working until the condition is met',
  // ant AZ3: `get isHidden(){return!v8()}` — visible only when running
  // non-interactively (headless / SDK / thinClient). In the REPL the
  // local-jsx flavour above handles it.
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  // ant AZ3: `isEnabled:()=>HoH()&&(v8()||V8())` — feature flag AND
  // (non-interactive OR remote workspace).
  isEnabled: () =>
    isGoalCommandEnabled() &&
    (getIsNonInteractiveSession() || getIsRemoteMode()),
  load: () => import('./goalLocal.js'),
}
