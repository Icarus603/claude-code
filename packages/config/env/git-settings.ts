/**
 * V7 §8.6 — `shouldIncludeGitInstructions` — env + settings-driven gate.
 *
 * Moved from src/utils/gitSettings.ts. Lives outside git.ts because git.ts
 * is in the vscode extension's dep graph and must stay free of settings.ts
 * (which transitively pulls @opentelemetry/api + undici).
 */

import { getInitialSettings } from '../settings/settings.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './utils.js'

export function shouldIncludeGitInstructions(): boolean {
  const envVal = process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS
  if (isEnvTruthy(envVal)) return false
  if (isEnvDefinedFalsy(envVal)) return true
  return getInitialSettings().includeGitInstructions ?? true
}
