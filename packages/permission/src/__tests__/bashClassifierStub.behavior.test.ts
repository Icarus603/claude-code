import { describe, expect, test } from 'bun:test'

import {
  PROMPT_PREFIX,
  classifyBashCommand,
  createPromptRuleContent,
  extractPromptDescription,
  generateGenericDescription,
  getBashPromptAllowDescriptions,
  getBashPromptAskDescriptions,
  getBashPromptDenyDescriptions,
  isClassifierPermissionsEnabled,
} from '../bashClassifier.ts'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin `bashClassifier.ts` — declared ANT-only stub in this build.
 *
 * The whole module is a no-op shim: `isClassifierPermissionsEnabled` returns
 * false, all getters return empty arrays, and classifyBashCommand always
 * returns matches:false. The pin prevents accidental activation (which
 * would call ant-only APIs that don't exist in this build).
 *
 * Important: this is NOT dead code. ccb's permission gates call these
 * functions on every Bash invocation, expecting "always-pass" semantics.
 * A regression that returned `matches: true` would falsely deny commands.
 */
describe('bashClassifier (ANT-only stub)', () => {
  test('PROMPT_PREFIX = "prompt:" (rule format prefix)', () => {
    // Pin: rule files use "prompt: <desc>" to mark classifier prompts.
    // A regression that changes the prefix would silently break rule
    // matching for any preserved ant rule files.
    expect(PROMPT_PREFIX).toBe('prompt:')
  })

  test('isClassifierPermissionsEnabled() is ALWAYS false in this build', () => {
    // Pin: this build is NOT ant. Returning true would activate ant-only
    // classifier APIs that aren't implemented here.
    expect(isClassifierPermissionsEnabled()).toBe(false)
  })

  test('extractPromptDescription(any) → null in this build', () => {
    // Pin: stub. A regression returning a string would inject classifier
    // descriptions into rule parsing.
    expect(extractPromptDescription(undefined)).toBeNull()
    expect(extractPromptDescription('')).toBeNull()
    expect(extractPromptDescription('prompt: foo')).toBeNull()
  })

  test('createPromptRuleContent returns "${PROMPT_PREFIX} ${trimmed}"', () => {
    // Pin: not a stub — this function builds the rule content even though
    // the classifier itself is disabled. Format must stay byte-equivalent
    // so any preserved ant rule files parse the same way on either build.
    expect(createPromptRuleContent('do x')).toBe('prompt: do x')
    expect(createPromptRuleContent('  trim me  ')).toBe('prompt: trim me')
  })

  test('classifyBashCommand always returns matches:false', async () => {
    // Pin: NEVER matches. A regression to `matches: true` would deny
    // every Bash command (the classifier path is hit by every dangerous
    // Bash invocation).
    const result = await classifyBashCommand(
      'rm -rf /',
      '/tmp',
      ['some description'],
      'deny',
      new AbortController().signal,
      false,
    )
    expect(result.matches).toBe(false)
  })

  test('classifyBashCommand confidence="high" reason="This feature is disabled"', () => {
    // Pin: stub-shape. Callers check confidence to decide retry; "high"
    // means "definitive answer, don't retry".
    return classifyBashCommand(
      'ls',
      '.',
      [],
      'allow',
      new AbortController().signal,
      false,
    ).then(result => {
      expect(result.confidence).toBe('high')
      expect(result.reason).toBe('This feature is disabled')
    })
  })

  test('all three getBashPrompt*Descriptions return []', () => {
    // Pin: empty array (NOT undefined). Callers spread these into rule
    // arrays — undefined would crash.
    expect(getBashPromptDenyDescriptions(undefined)).toEqual([])
    expect(getBashPromptAskDescriptions(undefined)).toEqual([])
    expect(getBashPromptAllowDescriptions(undefined)).toEqual([])
  })

  test('generateGenericDescription echoes specific description or null', async () => {
    // Pin: passthrough. NOT a regenerator — caller's description wins.
    const sig = new AbortController().signal
    expect(await generateGenericDescription('rm -rf /', 'wipe', sig)).toBe(
      'wipe',
    )
    expect(await generateGenericDescription('cmd', undefined, sig)).toBeNull()
  })

  test('generateGenericDescription empty string → null (NOT empty string)', async () => {
    // Pin: `specificDescription || null` — falsy short-circuit.
    const sig = new AbortController().signal
    expect(await generateGenericDescription('cmd', '', sig)).toBeNull()
  })
})

describe('bashClassifier — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'bashClassifier.ts'),
    'utf-8',
  )

  test('file declares "ANT-ONLY" stub status', () => {
    // Pin: top comment markers help future devs understand why everything
    // returns no-op. A refactor that removes this marker without flipping
    // the stub to live would be confusing.
    expect(source).toMatch(/Stub for external builds.+ANT-ONLY/i)
  })

  test('matches:false hardcoded in classifyBashCommand', () => {
    expect(source).toMatch(
      /classifyBashCommand[\s\S]+?matches: false/,
    )
  })

  test('classifierPermissionsEnabled returns false literal', () => {
    expect(source).toMatch(
      /isClassifierPermissionsEnabled\(\): boolean \{\s*\n?\s*return false\s*\n?\s*\}/,
    )
  })

  test('no transitive imports of ant-only modules (file is self-contained)', () => {
    // Pin: NO import statements at all (besides types). Adding any
    // import here pulls a dep into every ccb build.
    const importLines = source
      .split('\n')
      .filter(line => /^import /.test(line.trim()))
    expect(importLines).toEqual([])
  })
})
