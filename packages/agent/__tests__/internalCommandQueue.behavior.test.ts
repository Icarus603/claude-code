import { beforeAll, describe, expect, test } from 'bun:test'

import { isSlashCommand } from '../internal/commandQueue.js'
import { installAgentHostBindings } from '../host.js'
import type { AgentHostBindings } from '../contracts.js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

beforeAll(() => {
  // Empty host bindings — every method is optional, so optional-chain hits
  // fall through to the in-process fallback. This exercises the fallback
  // path, which is what we want to pin.
  installAgentHostBindings({} as AgentHostBindings)
})

/**
 * `internal/commandQueue.ts` exports three thin facades over host bindings:
 *   1. getCommandsByMaxPriority — returns [] when host isn't installed.
 *   2. remove — no-op when host isn't installed.
 *   3. isSlashCommand — host binding first; ELSE a real fallback heuristic.
 *
 * The fallback heuristic in isSlashCommand has real logic:
 *   - command.value must be a STRING
 *   - trimmed value starts with '/'
 *   - skipSlashCommands flag suppresses the detection (escape hatch)
 *
 * Behavior tested directly (callable from this process — no host installed
 * here, so the test exercises the fallback path).
 */
describe('internal/commandQueue isSlashCommand fallback', () => {
  // No host bindings installed in this test process → fallback runs.

  test('string starting with "/" → true', () => {
    expect(
      isSlashCommand({ mode: 'prompt', value: '/help' }),
    ).toBe(true)
  })

  test('string starting with leading whitespace + "/" → true (trims first)', () => {
    expect(
      isSlashCommand({ mode: 'prompt', value: '  /clear' }),
    ).toBe(true)
  })

  test('string starting with "/" — skipSlashCommands suppresses → false', () => {
    expect(
      isSlashCommand({
        mode: 'prompt',
        value: '/help',
        skipSlashCommands: true,
      }),
    ).toBe(false)
  })

  test('plain text (no leading slash) → false', () => {
    expect(
      isSlashCommand({ mode: 'prompt', value: 'just text' }),
    ).toBe(false)
  })

  test('empty string → false', () => {
    expect(isSlashCommand({ mode: 'prompt', value: '' })).toBe(false)
  })

  test('object value (not string) → false (typeof guard)', () => {
    expect(
      isSlashCommand({ mode: 'prompt', value: { not: 'string' } }),
    ).toBe(false)
  })

  test('number value → false', () => {
    expect(isSlashCommand({ mode: 'prompt', value: 42 })).toBe(false)
  })

  test('null value → false (no crash)', () => {
    expect(isSlashCommand({ mode: 'prompt', value: null })).toBe(false)
  })

  test('"/" alone (just the slash) → true (matches starts-with-/)', () => {
    expect(isSlashCommand({ mode: 'prompt', value: '/' })).toBe(true)
  })

  test('"//" (double-slash) → true (still starts with /)', () => {
    // Pin: the heuristic does NOT require a command word after the slash.
    // ant's parser handles the empty/double-slash case downstream.
    expect(isSlashCommand({ mode: 'prompt', value: '//comment' })).toBe(true)
  })

  test('"\\/help" (escaped slash) → false', () => {
    // Pin: ant's escape syntax. The literal first char is "\", not "/".
    expect(isSlashCommand({ mode: 'prompt', value: '\\/help' })).toBe(false)
  })
})

describe('internal/commandQueue source-level pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'internal', 'commandQueue.ts'),
    'utf-8',
  )

  test('getCommandsByMaxPriority returns [] when host is absent (NOT undefined)', () => {
    // Pin: caller iterates the result — undefined would crash.
    expect(source).toMatch(
      /if \(!getCommands\) \{\s*\n?\s*return \[\]\s*\n?\s*\}/,
    )
  })

  test('remove uses optional-chain (no-op when host absent)', () => {
    expect(source).toMatch(
      /removeCommandsFromQueue\?\.\(\s*\n?\s*commands\.map\(asQueuedCommandMessage\),/,
    )
  })

  test('isSlashCommand consults host binding FIRST', () => {
    // Pin: when host installed (e.g. with custom /cmd parser), defer to it.
    // The fallback runs ONLY when host doesn't provide isSlashCommand.
    expect(source).toMatch(
      /const check = getAgentHostBindings\(\)\.isSlashCommand\s*\n?\s*if \(check\)/,
    )
  })

  test('fallback priority enumeration: now | next | later', () => {
    // Pin: the priority union — a regression that adds 'urgent' would
    // need to be intentional and update consumers.
    expect(source).toMatch(/'now' \| 'next' \| 'later'/)
  })
})
