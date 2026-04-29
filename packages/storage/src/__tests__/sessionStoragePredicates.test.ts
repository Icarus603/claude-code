import { describe, expect, test } from 'bun:test'
import {
  isChainParticipant,
  isEphemeralToolProgress,
  isTranscriptMessage,
} from '../sessionStoragePredicates.js'

type Entry = Parameters<typeof isTranscriptMessage>[0]

describe('isTranscriptMessage', () => {
  // Critical contract: defines what messages count as transcript participants.
  // Wrong inclusion → progress messages persisted to JSONL → chain forks
  // (refs #14373, #23537). Wrong exclusion → conversation messages dropped.

  test('user message → true', () => {
    expect(isTranscriptMessage({ type: 'user' } as Entry)).toBe(true)
  })

  test('assistant message → true', () => {
    expect(isTranscriptMessage({ type: 'assistant' } as Entry)).toBe(true)
  })

  test('attachment message → true', () => {
    expect(isTranscriptMessage({ type: 'attachment' } as Entry)).toBe(true)
  })

  test('system message → true', () => {
    expect(isTranscriptMessage({ type: 'system' } as Entry)).toBe(true)
  })

  test('progress message → false (CRITICAL — must not persist)', () => {
    expect(isTranscriptMessage({ type: 'progress' } as Entry)).toBe(false)
  })

  test('grouped_tool_use → false', () => {
    expect(
      isTranscriptMessage({ type: 'grouped_tool_use' } as Entry),
    ).toBe(false)
  })

  test('arbitrary unknown type → false', () => {
    expect(
      isTranscriptMessage({ type: 'something_new' } as Entry),
    ).toBe(false)
  })
})

describe('isChainParticipant', () => {
  // Determines what messages participate in the parentUuid chain. Progress
  // explicitly excluded (ephemeral UI). Everything else participates.

  test('user → true', () => {
    expect(isChainParticipant({ type: 'user' })).toBe(true)
  })

  test('assistant → true', () => {
    expect(isChainParticipant({ type: 'assistant' })).toBe(true)
  })

  test('progress → false (CRITICAL — would orphan real conversation)', () => {
    expect(isChainParticipant({ type: 'progress' })).toBe(false)
  })

  test('grouped_tool_use → true (NOT progress)', () => {
    // Even though grouped_tool_use isn't a transcript message, it
    // participates in the chain. Documents the asymmetry between
    // isTranscriptMessage (4 types) and isChainParticipant (everything
    // except progress).
    expect(isChainParticipant({ type: 'grouped_tool_use' })).toBe(true)
  })

  test('attachment → true', () => {
    expect(isChainParticipant({ type: 'attachment' })).toBe(true)
  })

  test('system → true', () => {
    expect(isChainParticipant({ type: 'system' })).toBe(true)
  })
})

describe('isEphemeralToolProgress', () => {
  // High-frequency tool progress ticks: bash, powershell, mcp progress.
  // sleep_progress is gated behind PROACTIVE/KAIROS feature flags.

  test('bash_progress → true', () => {
    expect(isEphemeralToolProgress('bash_progress')).toBe(true)
  })

  test('powershell_progress → true', () => {
    expect(isEphemeralToolProgress('powershell_progress')).toBe(true)
  })

  test('mcp_progress → true', () => {
    expect(isEphemeralToolProgress('mcp_progress')).toBe(true)
  })

  test('non-progress type → false', () => {
    expect(isEphemeralToolProgress('user')).toBe(false)
    expect(isEphemeralToolProgress('assistant')).toBe(false)
    expect(isEphemeralToolProgress('progress')).toBe(false)
  })

  test('unknown progress type → false', () => {
    expect(isEphemeralToolProgress('unknown_progress')).toBe(false)
  })

  test('non-string input → false', () => {
    // Critical: `typeof dataType === 'string'` guard prevents
    // `Set.has(undefined)` from misbehaving + protects against
    // non-string entries in malformed transcripts.
    expect(isEphemeralToolProgress(undefined)).toBe(false)
    expect(isEphemeralToolProgress(null)).toBe(false)
    expect(isEphemeralToolProgress(42)).toBe(false)
    expect(isEphemeralToolProgress({ type: 'bash_progress' })).toBe(false)
    expect(isEphemeralToolProgress(['bash_progress'])).toBe(false)
  })

  test('case-sensitive match', () => {
    expect(isEphemeralToolProgress('BASH_PROGRESS')).toBe(false)
    expect(isEphemeralToolProgress('Bash_Progress')).toBe(false)
  })

  test('empty string → false', () => {
    expect(isEphemeralToolProgress('')).toBe(false)
  })
})
