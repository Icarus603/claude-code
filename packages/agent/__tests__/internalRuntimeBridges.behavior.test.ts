import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pins for `internal/runtimeBridges.ts` — five facades that
 * gate behind host bindings, four of which have a fallback used by tests /
 * pre-installation.
 *
 * Critical invariants:
 *  1. createCompactBoundaryMessage: when host binding fires, return that
 *     value. ELSE, build the message in-process — same shape exactly:
 *     type='system', subtype='compact_boundary', content='Conversation
 *     compacted', isMeta=false, level='info', compactMetadata={...}.
 *     A regression that drops the in-process fallback breaks tests + makes
 *     the compaction stream invisible to non-host-installed callers.
 *  2. logicalParentUuid is set ONLY when lastPreCompactMessageUuid is
 *     provided. The spread `...(x ? {logicalParentUuid: x} : {})` keeps
 *     the field optional (not present), NOT undefined.
 *  3. createDumpPromptsFetch fallback hits the GLOBAL fetch (NOT a thrown
 *     error or empty function). Pin so callers can always issue requests.
 *  4. recordTranscript returns null when host has no impl (NOT throw, NOT
 *     undefined). UI checks for null.
 */
describe('internal/runtimeBridges', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'internal', 'runtimeBridges.ts'),
    'utf-8',
  )

  describe('createCompactBoundaryMessage', () => {
    test('delegates to host binding first', () => {
      expect(source).toMatch(
        /createCompactBoundaryMessage\?\.\(\s*\n?\s*trigger,\s*\n?\s*preTokens,/,
      )
    })

    test('passes all 5 args to host (incl. messagesSummarized)', () => {
      expect(source).toMatch(
        /createCompactBoundaryMessage\?\.\(\s*\n?\s*trigger,\s*\n?\s*preTokens,\s*\n?\s*lastPreCompactMessageUuid,\s*\n?\s*userContext,\s*\n?\s*messagesSummarized,/,
      )
    })

    test('falls back to in-process construction when host returns nothing', () => {
      expect(source).toMatch(
        /if \(created\) \{\s*\n?\s*return created as CompactBoundaryMessage\s*\n?\s*\}/,
      )
    })

    test('fallback uses fixed content "Conversation compacted"', () => {
      // Pin: this exact string surfaces in transcripts; a refactor that
      // changes copy would create stale-vs-fresh inconsistency for users.
      expect(source).toMatch(/content: 'Conversation compacted'/)
    })

    test('fallback type=system subtype=compact_boundary level=info isMeta=false', () => {
      expect(source).toMatch(/type: 'system'/)
      expect(source).toMatch(/subtype: 'compact_boundary'/)
      expect(source).toMatch(/level: 'info'/)
      expect(source).toMatch(/isMeta: false/)
    })

    test('fallback uses randomUUID + new Date().toISOString()', () => {
      // Pin: uuid + ISO timestamp. A regression to a counter or epoch ms
      // breaks downstream ordering / search.
      expect(source).toMatch(/import \{ randomUUID \} from 'crypto'/)
      expect(source).toMatch(/uuid: randomUUID\(\)/)
      expect(source).toMatch(/timestamp: new Date\(\)\.toISOString\(\)/)
    })

    test('logicalParentUuid present ONLY when lastPreCompactMessageUuid provided', () => {
      // Pin: spread-conditional, NOT `logicalParentUuid: x ?? undefined`.
      // A regression to the ?? form leaves the key present with undefined,
      // which serializes differently in JSON.
      expect(source).toMatch(
        /\.\.\.\(lastPreCompactMessageUuid\s*\n?\s*\?\s*\{ logicalParentUuid: lastPreCompactMessageUuid \}\s*\n?\s*: \{\}\)/,
      )
    })

    test('compactMetadata carries trigger + preTokens + optional userContext/messagesSummarized', () => {
      expect(source).toMatch(/compactMetadata: \{\s*\n?\s*trigger,/)
      expect(source).toMatch(/preTokens,/)
      expect(source).toMatch(/userContext,/)
      expect(source).toMatch(/messagesSummarized,/)
    })
  })

  describe('recordTranscript', () => {
    test('returns null (NOT undefined, NOT throw) when host has no impl', () => {
      // Pin: callers check `if (uuid !== null)`. Empty string or undefined
      // would falsy-match but mess up downstream JSON serialization.
      expect(source).toMatch(/if \(!record\) \{\s*\n?\s*return null\s*\n?\s*\}/)
    })

    test('passes all 4 args (messages, teamInfo, parentUuidHint, allMessages)', () => {
      expect(source).toMatch(
        /record\(messages, teamInfo, startingParentUuidHint, allMessages\)/,
      )
    })
  })

  describe('flushSessionStorage', () => {
    test('optional-chain await (no-op when host absent)', () => {
      expect(source).toMatch(
        /flushSessionStorage[\s\S]{0,200}?await getAgentHostBindings\(\)\.flushSessionStorage\?\.\(\)/,
      )
    })
  })

  describe('recordContentReplacement', () => {
    test('optional-chain await with both args', () => {
      expect(source).toMatch(
        /recordContentReplacement\?\.\(\s*\n?\s*replacements,\s*\n?\s*agentId,/,
      )
    })
  })

  describe('createDumpPromptsFetch', () => {
    test('fallback uses globalThis.fetch (NOT throw)', () => {
      // Pin: callers always get a usable fetch. A throwing fallback would
      // crash anyone who tries to issue a request without --dump-prompts.
      expect(source).toMatch(
        /\(\(input, init\) => globalThis\.fetch\(input, init\)\)/,
      )
    })

    test('host binding consulted first via ?? operator', () => {
      expect(source).toMatch(
        /createDumpPromptsFetch\?\.\(agentIdOrSessionId\)\s*\?\?/,
      )
    })
  })

  test('CompactBoundaryMessage type is module-local (NOT exported)', () => {
    // Pin: the shape is enforced internally; external callers should see
    // it via AgentMessage union. Exporting would invite drift.
    expect(source).not.toMatch(/^export type CompactBoundaryMessage/m)
  })
})
