import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pins for `internal/runtimeSignals.ts` — three optional-chained
 * delegators to host bindings. These are called from the query hot path and
 * provide diagnostic checkpoints + command-lifecycle notifications.
 *
 * Invariants:
 *  1. All three delegate via `getAgentHostBindings().X?.(...)` — never throw
 *     if the host hasn't installed the binding.
 *  2. notifyCommandLifecycle accepts ONLY 'started' | 'completed' (a union
 *     a refactor might widen — pin it).
 *  3. headlessProfilerCheckpoint and queryCheckpoint are NAME-only (no
 *     metadata payload). The host decides what to do with the name.
 */
describe('internal/runtimeSignals', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'internal', 'runtimeSignals.ts'),
    'utf-8',
  )

  test('headlessProfilerCheckpoint delegates via optional chain (no host = no-op)', () => {
    expect(source).toMatch(
      /headlessProfilerCheckpoint\(name: string\): void \{\s*\n?\s*getAgentHostBindings\(\)\.headlessProfilerCheckpoint\?\.\(name\)/,
    )
  })

  test('queryCheckpoint delegates via optional chain', () => {
    expect(source).toMatch(
      /queryCheckpoint\(name: string\): void \{\s*\n?\s*getAgentHostBindings\(\)\.queryCheckpoint\?\.\(name\)/,
    )
  })

  test('notifyCommandLifecycle delegates with both args', () => {
    expect(source).toMatch(
      /notifyCommandLifecycle\([\s\S]*?uuid: string,[\s\S]*?state: 'started' \| 'completed'/,
    )
    expect(source).toMatch(
      /getAgentHostBindings\(\)\.notifyCommandLifecycle\?\.\(uuid, state\)/,
    )
  })

  test('state union is EXACTLY started|completed (no other states)', () => {
    // Pin: a refactor that adds 'in_progress' would change downstream UI.
    // If you need more states, add them deliberately AND update this test.
    expect(source).toMatch(/'started' \| 'completed'/)
    expect(source).not.toMatch(/'in_progress'/)
    expect(source).not.toMatch(/'cancelled'/)
  })

  test('imports getAgentHostBindings from "../host.js"', () => {
    expect(source).toMatch(
      /import \{ getAgentHostBindings \} from '\.\.\/host\.js'/,
    )
  })

  test('all three are exported (consumed by query, command runtime)', () => {
    expect(source).toMatch(/^export function headlessProfilerCheckpoint/m)
    expect(source).toMatch(/^export function queryCheckpoint/m)
    expect(source).toMatch(/^export function notifyCommandLifecycle/m)
  })
})
