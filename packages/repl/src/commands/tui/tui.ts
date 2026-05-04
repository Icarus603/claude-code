import {
  getInitialSettings,
  updateSettingsForSource,
} from '@claude-code/config/settings'
import { isEnvDefinedFalsy, isEnvTruthy } from '@claude-code/config/env/utils'
import { isFullscreenEnvEnabled } from '../../fullscreen.js'
import { relaunchCli } from '../../relaunch.js'

const VALID_RENDERERS = ['default', 'fullscreen'] as const
type Renderer = (typeof VALID_RENDERERS)[number]

function isValidRenderer(value: string): value is Renderer {
  return (VALID_RENDERERS as readonly string[]).includes(value)
}

/**
 * Resolve which renderer is currently in effect — this drives the "Already
 * using the X renderer" short-circuit so we don't relaunch unnecessarily.
 *
 * Mirrors isFullscreenEnvEnabled but reports the human-readable label.
 */
function getCurrentRenderer(): Renderer {
  return isFullscreenEnvEnabled() ? 'fullscreen' : 'default'
}

export async function call(
  args?: string,
): Promise<{ type: 'text'; value: string }> {
  const trimmed = (args ?? '').trim().toLowerCase()
  const current = getCurrentRenderer()

  if (trimmed === '') {
    return {
      type: 'text',
      value: `Current renderer: ${current}. Usage: /tui <${VALID_RENDERERS.join(
        '|',
      )}>`,
    }
  }

  if (!isValidRenderer(trimmed)) {
    return {
      type: 'text',
      value: `Unknown renderer "${trimmed}". Usage: /tui <${VALID_RENDERERS.join(
        '|',
      )}>`,
    }
  }

  if (trimmed === current) {
    return { type: 'text', value: `Already using the ${trimmed} renderer.` }
  }

  // CLAUDE_CODE_NO_FLICKER env always wins over settings, so a user who set
  // it explicitly won't see settings take effect on relaunch. Warn loudly
  // instead of silently writing a setting that does nothing.
  const envSet =
    isEnvDefinedFalsy(process.env.CLAUDE_CODE_NO_FLICKER) ||
    isEnvTruthy(process.env.CLAUDE_CODE_NO_FLICKER)
  if (envSet) {
    return {
      type: 'text',
      value: `CLAUDE_CODE_NO_FLICKER is set in your environment — it overrides /tui. Unset it (or change the value) and re-run /tui.`,
    }
  }

  const { error } = updateSettingsForSource('userSettings', { tui: trimmed })
  if (error) {
    return {
      type: 'text',
      value: `Failed to save setting: ${error.message}`,
    }
  }

  // Relaunch ccb so the new mode takes effect. relaunchCli never returns —
  // it spawns a child with stdio:'inherit' and exits with the child's code.
  // The marker env var lets the new process detect a TUI-driven relaunch
  // (for analytics / future bounce-detection).
  await relaunchCli({
    freshIfNoTranscript: true,
    env: { CLAUDE_CODE_TUI_JUST_SWITCHED: trimmed },
  })

  // Unreachable — relaunchCli calls process.exit. Returned for type safety.
  return { type: 'text', value: `Switching to ${trimmed} renderer…` }
}

// Re-export for external callers that need to programmatically check the
// current renderer (e.g., diagnostics / status bar).
export { getCurrentRenderer }
// Marker export so verifiers know `tui` is the canonical command file.
export const TUI_COMMAND_NAME = 'tui'

// Pre-existing settings reader, re-exported here for tests that need to
// confirm the persisted value without round-tripping through settings cache.
export function getTuiSetting(): Renderer | undefined {
  return getInitialSettings().tui
}
