/**
 * Tests for stateToSnapshotMessage + restoreAttributionStateFromSnapshots
 * + incrementPromptCount — pure helpers for serializing/deserializing
 * the AttributionState across compaction + session resume.
 *
 * Wrong serialization = char counts double across compaction (a known
 * bug class noted in commitAttribution.ts: "837 snapshots × 280 files
 * → 1.15 quadrillion chars" if you SUM instead of taking the LAST).
 *
 * Wrong restore = session resume loses partial work; user-Pry mode
 * loses the original repo's class detection.
 */
import { describe, expect, test } from 'bun:test'
import {
  createEmptyAttributionState,
  incrementPromptCount,
  restoreAttributionStateFromSnapshots,
  stateToSnapshotMessage,
} from '../commitAttribution.js'
import type { UUID } from 'crypto'
import type { AttributionSnapshotMessage } from '../logsTypes.js'

const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000' as UUID

describe('stateToSnapshotMessage', () => {
  test('empty state → message with empty fileStates record + zero counters', () => {
    const state = createEmptyAttributionState()
    const m = stateToSnapshotMessage(state, TEST_UUID)
    expect(m.type).toBe('attribution-snapshot')
    expect(m.messageId).toBe(TEST_UUID)
    expect(m.fileStates).toEqual({})
    expect(m.promptCount).toBe(0)
    expect(m.promptCountAtLastCommit).toBe(0)
  })

  test('state with file → fileStates record entries', () => {
    const state = createEmptyAttributionState()
    state.fileStates.set('foo.ts', {
      contentHash: 'abc',
      claudeContribution: 100,
      mtime: 0,
    })
    const m = stateToSnapshotMessage(state, TEST_UUID)
    expect(m.fileStates['foo.ts']).toEqual({
      contentHash: 'abc',
      claudeContribution: 100,
      mtime: 0,
    })
  })

  test('all counter fields preserved verbatim', () => {
    const state = createEmptyAttributionState()
    state.promptCount = 42
    state.promptCountAtLastCommit = 30
    state.permissionPromptCount = 5
    state.permissionPromptCountAtLastCommit = 3
    state.escapeCount = 7
    state.escapeCountAtLastCommit = 4
    const m = stateToSnapshotMessage(state, TEST_UUID)
    expect(m.promptCount).toBe(42)
    expect(m.promptCountAtLastCommit).toBe(30)
    expect(m.permissionPromptCount).toBe(5)
    expect(m.permissionPromptCountAtLastCommit).toBe(3)
    expect(m.escapeCount).toBe(7)
    expect(m.escapeCountAtLastCommit).toBe(4)
  })

  test('multiple files: all entries in fileStates', () => {
    const state = createEmptyAttributionState()
    state.fileStates.set('a.ts', {
      contentHash: 'a',
      claudeContribution: 10,
      mtime: 1,
    })
    state.fileStates.set('b.ts', {
      contentHash: 'b',
      claudeContribution: 20,
      mtime: 2,
    })
    const m = stateToSnapshotMessage(state, TEST_UUID)
    expect(Object.keys(m.fileStates).sort()).toEqual(['a.ts', 'b.ts'])
  })
})

describe('restoreAttributionStateFromSnapshots', () => {
  test('empty array → empty state', () => {
    const r = restoreAttributionStateFromSnapshots([])
    expect(r.fileStates.size).toBe(0)
    expect(r.promptCount).toBe(0)
  })

  test('single snapshot: state restored verbatim', () => {
    const snapshot: AttributionSnapshotMessage = {
      type: 'attribution-snapshot',
      messageId: TEST_UUID,
      surface: 'cli',
      fileStates: {
        'foo.ts': { contentHash: 'h', claudeContribution: 50, mtime: 0 },
      },
      promptCount: 5,
      promptCountAtLastCommit: 3,
      permissionPromptCount: 0,
      permissionPromptCountAtLastCommit: 0,
      escapeCount: 0,
      escapeCountAtLastCommit: 0,
    }
    const r = restoreAttributionStateFromSnapshots([snapshot])
    expect(r.fileStates.get('foo.ts')).toEqual({
      contentHash: 'h',
      claudeContribution: 50,
      mtime: 0,
    })
    expect(r.promptCount).toBe(5)
    expect(r.surface).toBe('cli')
  })

  test('multiple snapshots: ONLY LAST is used (no summing)', () => {
    // Documented contract: snapshots are full-state dumps, NOT deltas.
    // Summing across snapshots causes quadratic growth (the bug noted
    // in commitAttribution.ts header comment).
    const snap1: AttributionSnapshotMessage = {
      type: 'attribution-snapshot',
      messageId: TEST_UUID,
      surface: 'old',
      fileStates: {
        'foo.ts': { contentHash: 'h1', claudeContribution: 100, mtime: 0 },
      },
      promptCount: 1,
      promptCountAtLastCommit: 0,
      permissionPromptCount: 0,
      permissionPromptCountAtLastCommit: 0,
      escapeCount: 0,
      escapeCountAtLastCommit: 0,
    }
    const snap2: AttributionSnapshotMessage = {
      type: 'attribution-snapshot',
      messageId: TEST_UUID,
      surface: 'new',
      fileStates: {
        'foo.ts': { contentHash: 'h2', claudeContribution: 50, mtime: 1 },
        'bar.ts': { contentHash: 'b', claudeContribution: 25, mtime: 1 },
      },
      promptCount: 5,
      promptCountAtLastCommit: 3,
      permissionPromptCount: 0,
      permissionPromptCountAtLastCommit: 0,
      escapeCount: 0,
      escapeCountAtLastCommit: 0,
    }
    const r = restoreAttributionStateFromSnapshots([snap1, snap2])
    // Last wins: foo.ts has h2/50, NOT h1+h2/150.
    expect(r.fileStates.get('foo.ts')).toEqual({
      contentHash: 'h2',
      claudeContribution: 50,
      mtime: 1,
    })
    expect(r.fileStates.get('bar.ts')).toEqual({
      contentHash: 'b',
      claudeContribution: 25,
      mtime: 1,
    })
    expect(r.surface).toBe('new')
    expect(r.promptCount).toBe(5)
  })

  test('missing optional counter fields default to 0', () => {
    const snap: AttributionSnapshotMessage = {
      type: 'attribution-snapshot',
      messageId: TEST_UUID,
      surface: 'cli',
      fileStates: {},
      // Missing promptCount, etc.
    } as unknown as AttributionSnapshotMessage
    const r = restoreAttributionStateFromSnapshots([snap])
    expect(r.promptCount).toBe(0)
    expect(r.permissionPromptCount).toBe(0)
    expect(r.escapeCount).toBe(0)
  })
})

describe('incrementPromptCount', () => {
  test('increments by 1 + saves snapshot', () => {
    let savedSnapshot: AttributionSnapshotMessage | null = null
    const state = createEmptyAttributionState()
    const result = incrementPromptCount(state, snap => {
      savedSnapshot = snap
    })
    expect(result.promptCount).toBe(1)
    expect(savedSnapshot).not.toBeNull()
    expect(savedSnapshot?.promptCount).toBe(1)
  })

  test('does NOT mutate original state', () => {
    const state = createEmptyAttributionState()
    state.promptCount = 5
    const result = incrementPromptCount(state, () => {})
    expect(result.promptCount).toBe(6)
    expect(state.promptCount).toBe(5) // original unchanged
  })

  test('snapshot includes incremented count (not original)', () => {
    let savedCount: number | null = null
    const state = createEmptyAttributionState()
    state.promptCount = 10
    incrementPromptCount(state, snap => {
      savedCount = snap.promptCount
    })
    expect(savedCount).toBe(11)
  })

  test('preserves all OTHER counter fields', () => {
    const state = createEmptyAttributionState()
    state.promptCount = 1
    state.promptCountAtLastCommit = 0
    state.permissionPromptCount = 5
    state.escapeCount = 3
    const result = incrementPromptCount(state, () => {})
    expect(result.promptCountAtLastCommit).toBe(0)
    expect(result.permissionPromptCount).toBe(5)
    expect(result.escapeCount).toBe(3)
  })
})

describe('round-trip: state → snapshot → restore', () => {
  test('non-empty state survives round-trip', () => {
    const original = createEmptyAttributionState()
    original.fileStates.set('a.ts', {
      contentHash: 'h',
      claudeContribution: 50,
      mtime: 0,
    })
    original.promptCount = 5
    original.escapeCount = 2

    const snapshot = stateToSnapshotMessage(original, TEST_UUID)
    const restored = restoreAttributionStateFromSnapshots([snapshot])

    expect(restored.fileStates.get('a.ts')).toEqual({
      contentHash: 'h',
      claudeContribution: 50,
      mtime: 0,
    })
    expect(restored.promptCount).toBe(5)
    expect(restored.escapeCount).toBe(2)
  })
})
