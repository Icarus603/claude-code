// These side-effects must run before all other imports:
// 1. profileCheckpoint marks entry before heavy module evaluation begins
// 2. startMdmRawRead fires MDM subprocesses (plutil/reg query) so they run in
//    parallel with the remaining ~135ms of imports below
// 3. startKeychainPrefetch fires both macOS keychain reads (OAuth + legacy API
//    key) in parallel — isRemoteManagedSettingsEligible() otherwise reads them
//    sequentially via sync spawn inside applySafeConfigEnvironmentVariables()
//    (~65ms on every macOS startup)
import { profileCheckpoint } from "./utils/startupProfiler.js";

// eslint-disable-next-line custom-rules/no-top-level-side-effects
profileCheckpoint("main_tsx_entry");

import { startMdmRawRead } from "./utils/settings/mdm/rawRead.js";

// eslint-disable-next-line custom-rules/no-top-level-side-effects
startMdmRawRead();

import { startKeychainPrefetch } from "./utils/secureStorage/keychainPrefetch.js";

// eslint-disable-next-line custom-rules/no-top-level-side-effects
startKeychainPrefetch();

import './runtime/bootstrap.js'

import type { RuntimeHandles } from '@claude-code/app-host'
import { getGlobalConfig, saveGlobalConfig } from '@claude-code/config'
import { setThemeConfigCallbacks } from '@anthropic/ink'
import { runClaudeCode } from '@claude-code/cli'

import { createRuntimeHandles } from './runtime/runtimeHandles.js'
import { startDeferredPrefetches } from './main/startup/context.js'

export { startDeferredPrefetches };

// eslint-disable-next-line custom-rules/no-top-level-side-effects
profileCheckpoint("main_tsx_imports_loaded");

// Wire up theme config persistence into @anthropic/ink's ThemeProvider.
// eslint-disable-next-line custom-rules/no-top-level-side-effects
setThemeConfigCallbacks({
  loadTheme: () => {
    try {
      return getGlobalConfig().theme
    } catch {
      // ThemeProvider mounts before enableConfigs() in interactive startup.
      // Fall back to a safe default for first render, then later reads use config.
      return 'dark'
    }
  },
  saveTheme: setting => {
    try {
      saveGlobalConfig(c => ({ ...c, theme: setting }))
    } catch {
      // Ignore pre-config startup writes; interactive settings saves happen
      // after enableConfigs() and will persist normally.
    }
  },
})

export async function main(): Promise<void> {
  const runtimeHandles: RuntimeHandles = createRuntimeHandles()
  await runClaudeCode(runtimeHandles)
}
