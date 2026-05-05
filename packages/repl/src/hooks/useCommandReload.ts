import { useCallback, useEffect, useRef } from 'react'
import type { Command } from '@claude-code/command-runtime/runtime'
import {
  clearCommandMemoizationCaches,
  clearCommandsCache,
  getCommands,
} from '@claude-code/command-runtime/runtime'
import { onGrowthBookRefresh } from '@claude-code/config/feature-flags'
import { logError } from '@claude-code/local-observability/logging'
import { skillChangeDetector } from '@claude-code/tool-registry/skills/skillChangeDetector.js'

/**
 * Keep the REPL's `localCommands` state fresh across every trigger that can
 * change the canonical `getCommands(cwd)` result:
 *
 * 1. Skill file changes (watcher) — full cache clear + disk re-scan, since
 *    skill content changed on disk.
 * 2. GrowthBook init/refresh — memo-only clear, since only `isEnabled()`
 *    predicates may have changed. Handles commands like /btw whose gate
 *    reads a flag that isn't in the disk cache yet on first session after
 *    a flag rename: getCommands() runs before GB init (main.tsx:2855 vs
 *    showSetupScreens at :3106), so the memoized list is baked with the
 *    default. Once init populates remoteEvalFeatureValues, re-filter.
 * 3. Plugin lifecycle — `/reload-plugins` and the install/uninstall paths
 *    call `refreshActivePlugins`, which clears every plugin/command cache
 *    and pushes a new `plugins.commands` array into AppState. The REPL
 *    holds the post-merge command list in `localCommands` (so MCP+plugin
 *    commands flow through `useMergedCommands`), and that state was
 *    previously only re-derived by triggers (1) and (2). Without this
 *    third subscription, an uninstalled plugin's commands stayed in the
 *    typeahead popup (and the executable command list) until session
 *    restart.
 *
 * `pluginCommandsRef` is the AppState mirror of `plugins.commands` from
 * `refreshActivePlugins`. We use its identity (not contents) as the
 * dependency — refresh always allocates a new array, so a !== compare is
 * cheap and avoids deep equality. The first effect run on mount re-fetches
 * the same array `initialCommands` was derived from, so it's effectively a
 * no-op (cleared-then-warmed loadAllCommands memo).
 */
export function useCommandReload(
  cwd: string | undefined,
  pluginCommandsRef: readonly Command[],
  onCommandsChange: (commands: Command[]) => void,
): void {
  const handleChange = useCallback(async () => {
    if (!cwd) return
    try {
      // Clear all command caches to ensure fresh load
      clearCommandsCache()
      const commands = await getCommands(cwd)
      onCommandsChange(commands)
    } catch (error) {
      // Errors during reload are non-fatal - log and continue
      if (error instanceof Error) {
        logError(error)
      }
    }
  }, [cwd, onCommandsChange])

  useEffect(() => skillChangeDetector.subscribe(handleChange), [handleChange])

  const handleGrowthBookRefresh = useCallback(async () => {
    if (!cwd) return
    try {
      clearCommandMemoizationCaches()
      const commands = await getCommands(cwd)
      onCommandsChange(commands)
    } catch (error) {
      if (error instanceof Error) {
        logError(error)
      }
    }
  }, [cwd, onCommandsChange])

  useEffect(
    () => onGrowthBookRefresh(handleGrowthBookRefresh),
    [handleGrowthBookRefresh],
  )

  // refreshActivePlugins has already cleared the plugin caches by the time
  // the new commands array lands in AppState — handleChange's
  // clearCommandsCache() is redundant on this path but cheap, and keeps
  // every trigger semantically identical (clear → re-fetch → swap).
  // Skip the mount-time invocation: initialCommands is already derived
  // from the same getCommands() call, so the first render's pluginCommandsRef
  // identity matches what we'd otherwise re-fetch.
  const isFirstPluginRunRef = useRef(true)
  useEffect(() => {
    if (isFirstPluginRunRef.current) {
      isFirstPluginRunRef.current = false
      return
    }
    void handleChange()
  }, [pluginCommandsRef, handleChange])
}
