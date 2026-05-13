import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pins for `internal/headlessRuntime.ts` — 16 facades over
 * host bindings used by the headless / --print mode loop.
 *
 * The big invariant: each facade has a deterministic fallback when the
 * host binding is missing. The fallbacks aren't arbitrary — they're tuned
 * so headless mode degrades gracefully (returns empty arrays/objects)
 * instead of crashing.
 *
 * Pinning each fallback so a refactor doesn't accidentally change "no
 * host → []" to "no host → throw" or "no host → undefined".
 */
describe('internal/headlessRuntime fallbacks', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'internal', 'headlessRuntime.ts'),
    'utf-8',
  )

  describe('passthrough fallbacks (input echoed unchanged)', () => {
    test('parseUserSpecifiedModel: no host → echo model back', () => {
      // Pin: caller passes user-typed model id; if no host parser,
      // the raw string is the best we can do.
      expect(source).toMatch(
        /parseUserSpecifiedModel\?\.\(model\) \?\? model/,
      )
    })

    test('sdkCompatToolName: no host → echo toolName back', () => {
      expect(source).toMatch(
        /sdkCompatToolName\?\.\(toolName\) \?\? toolName/,
      )
    })
  })

  describe('empty/falsy fallbacks (degrade gracefully)', () => {
    test('getMainLoopModel: no host → "" (empty string, not undefined)', () => {
      // Pin: callers use the result as a string. undefined would crash
      // on .startsWith etc.
      expect(source).toMatch(/getMainLoopModel\?\.\(\) \?\? ''/)
    })

    test('loadAllPluginsCacheOnly: no host → { enabled: [] }', () => {
      // Pin: caller iterates .enabled — empty array means "no plugins",
      // not "crash".
      expect(source).toMatch(
        /loadAllPluginsCacheOnly\?\.\(\)\)\s*\?\?\s*\{\s*\n?\s*enabled: \[\],/,
      )
    })

    test('processUserInput: no host → shouldQuery=false, messages=[]', () => {
      // Pin: shouldQuery=false means "skip the LLM call". Returning true
      // would route a null message to the model.
      expect(source).toMatch(
        /processUserInput[\s\S]+?\?\?\s*\{\s*\n?\s*messages: \[\],\s*\n?\s*shouldQuery: false,\s*\n?\s*allowedTools: undefined,/,
      )
    })

    test('fetchSystemPromptParts: no host → empty defaults (no crash on map access)', () => {
      expect(source).toMatch(
        /fetchSystemPromptParts[\s\S]+?\?\?\s*\{\s*\n?\s*defaultSystemPrompt: \[\],\s*\n?\s*userContext: \{\},\s*\n?\s*systemContext: \{\},/,
      )
    })

    test('isResultSuccessful: no host → false (NOT true, NOT undefined)', () => {
      // Pin: defaulting to true would treat un-host-installed runs as
      // always-successful — masks bugs.
      expect(source).toMatch(
        /isResultSuccessful\?\.\(result, lastStopReason\) \?\? false/,
      )
    })

    test('selectableUserMessagesFilter: no host → true (include all)', () => {
      // Pin: inverse of isResultSuccessful — for filters, true means
      // "include". Without a host filter, include every message.
      expect(source).toMatch(
        /selectableUserMessagesFilter\?\.\(message\) \?\? true/,
      )
    })

    test('getCoordinatorUserContext: no host → {} (empty record)', () => {
      expect(source).toMatch(
        /getCoordinatorUserContext\?\.\([\s\S]+?\) \?\? \{\}/,
      )
    })

    test('isSnipBoundaryMessage: no host → false (NOT a snip)', () => {
      expect(source).toMatch(
        /isSnipBoundaryMessage\?\.\(message\) \?\? false/,
      )
    })
  })

  describe('generator early-return fallbacks', () => {
    test('handleOrphanedPermission: no host → empty generator (return)', () => {
      // Pin: AsyncGenerator must yield 0 items, not throw.
      expect(source).toMatch(
        /handleOrphanedPermission[\s\S]+?if \(!handler\) \{\s*\n?\s*return\s*\n?\s*\}\s*\n?\s*yield\* handler\(/,
      )
    })

    test('normalizeMessage: no host → empty generator (return)', () => {
      expect(source).toMatch(
        /normalizeMessage[\s\S]+?if \(!normalizer\) \{\s*\n?\s*return\s*\n?\s*\}\s*\n?\s*yield\* normalizer\(/,
      )
    })
  })

  describe('undefined-allowed fallbacks (caller checks explicitly)', () => {
    test('shouldEnableThinkingByDefault returns boolean | undefined', () => {
      // Pin: tri-state (true/false/undefined). undefined means "use default".
      // Caller distinguishes "host says false" from "no host".
      expect(source).toMatch(
        /shouldEnableThinkingByDefault\(\): boolean \| undefined/,
      )
      expect(source).toMatch(
        /getAgentHostBindings\(\)\.shouldEnableThinkingByDefault\?\.\(\)/,
      )
    })

    test('buildSystemInitMessage returns unknown | undefined (no fallback)', () => {
      // Pin: passing undefined through; caller checks before sending.
      const block = source.match(
        /export function buildSystemInitMessage[\s\S]+?\n\}/,
      )?.[0]
      expect(block).toBeTruthy()
      // No `?? something` — undefined passes through.
      expect(block).not.toMatch(/\?\? /)
    })

    test('snipCompactIfNeeded returns undefined when no host (skip snip)', () => {
      // Pin: caller checks `if (result)` before using. undefined =
      // "snip skipped" semantics.
      const block = source.match(
        /export function snipCompactIfNeeded[\s\S]+?\n\}/,
      )?.[0]
      expect(block).toBeTruthy()
      expect(block).not.toMatch(/\?\? /)
    })
  })

  describe('side-effect facades', () => {
    test('registerStructuredOutputEnforcement: optional-chain no-op', () => {
      // Pin: void return — when host has no impl, calling is silent no-op.
      expect(source).toMatch(
        /registerStructuredOutputEnforcement\?\.\(\s*\n?\s*setAppState,\s*\n?\s*sessionId,/,
      )
    })
  })

  test('all 16 exports present', () => {
    const exportLines = source
      .split('\n')
      .filter(line => /^export (function|async function)/.test(line))
    expect(exportLines.length).toBe(16)
  })

  test('every export uses optional-chain on host binding access', () => {
    // Pin: no facade should throw on missing host. A regression that
    // does `getAgentHostBindings().X(...)` without `?.` would crash
    // anyone running headless mode without the host wired up.
    //
    // Allowed: function body destructures the binding and checks falsy
    // (handleOrphanedPermission / normalizeMessage); both still avoid
    // calling on undefined.
    const directNonOptionalCalls = source.match(
      /getAgentHostBindings\(\)\.[a-zA-Z_$][a-zA-Z0-9_$]*\(/g,
    )
    // No matches expected — all calls should be via `?.(`
    expect(directNonOptionalCalls).toBeNull()
  })
})
