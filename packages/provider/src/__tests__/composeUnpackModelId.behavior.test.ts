import { describe, expect, test } from 'bun:test'

import { composeModelId, unpackModelId } from '../connections.ts'

/**
 * Pin packed model-id format. The pack/unpack pair is the foundation of
 * V7 §11.6 multi-connection routing — internally ccb uses
 * `<connectionId>:<modelId>` (e.g. `claude-account:claude-opus-4-7`) so
 * the same bare wire id (`claude-opus-4-7`) can come from multiple
 * connections (Claude Account, OpenAI-compat proxy, etc.).
 *
 * Bug history: doctor:arch ships verify-no-packed-modelid-leak that
 * catches packed strings leaking into user-facing surfaces (system
 * prompt, /context, /config, error messages). This test file pins the
 * pack/unpack format itself so the verifier's expectations stay valid.
 *
 * The rejection-of-paths heuristic (slash/dot in connId head) prevents
 * `models/gemini-2.5-pro` from being mis-split into connId=`models` +
 * modelId=`gemini-2.5-pro`. Pin this carefully.
 */
describe('composeModelId / unpackModelId (V7 §11.6 packed-form)', () => {
  describe('composeModelId', () => {
    test('no connId → returns bare modelId unchanged (legacy/env path)', () => {
      expect(composeModelId(undefined, 'claude-opus-4-7')).toBe('claude-opus-4-7')
    })

    test('with connId → joins via colon', () => {
      expect(composeModelId('claude-account', 'claude-opus-4-7')).toBe(
        'claude-account:claude-opus-4-7',
      )
    })

    test('empty-string connId is treated as undefined (no false pack)', () => {
      expect(composeModelId('', 'claude-opus-4-7')).toBe('claude-opus-4-7')
    })

    test('connId with hyphens preserved verbatim (no normalization)', () => {
      expect(composeModelId('conn_abc-def', 'sonnet')).toBe('conn_abc-def:sonnet')
    })
  })

  describe('unpackModelId', () => {
    test('packed form → splits into connId + modelId', () => {
      expect(unpackModelId('claude-account:claude-opus-4-7')).toEqual({
        connectionId: 'claude-account',
        modelId: 'claude-opus-4-7',
      })
    })

    test('bare form (no colon) → connectionId undefined, modelId unchanged', () => {
      expect(unpackModelId('claude-opus-4-7')).toEqual({
        connectionId: undefined,
        modelId: 'claude-opus-4-7',
      })
    })

    test('REJECTS slashes in head (e.g. "models/gemini-2.5-pro") — would be mis-split otherwise', () => {
      // CRITICAL: Vertex/Gemini model ids have the form "models/gemini-2.5-pro".
      // If unpack mistakenly treated "models" as a connId, every Gemini call
      // would route through a non-existent connection.
      expect(unpackModelId('models/gemini-2.5-pro')).toEqual({
        connectionId: undefined,
        modelId: 'models/gemini-2.5-pro',
      })
    })

    test('REJECTS dots in head (e.g. "claude.opus-4:something")', () => {
      // Defensive: connection ids are alphanumeric + underscore + hyphen
      // (regenerated via generateConnectionId). A dot signals a model
      // namespace rather than a connection id.
      expect(unpackModelId('claude.opus-4:foo')).toEqual({
        connectionId: undefined,
        modelId: 'claude.opus-4:foo',
      })
    })

    test('idx === 0 (leading colon) → treated as bare (idx <= 0 guard)', () => {
      // The check is `idx <= 0`, not `idx < 0`. A leading colon shouldn't
      // unpack to empty-string connId.
      expect(unpackModelId(':claude-opus-4-7')).toEqual({
        connectionId: undefined,
        modelId: ':claude-opus-4-7',
      })
    })

    test('only the FIRST colon is the split (modelIds may contain colons)', () => {
      // ccb uses indexOf, not lastIndexOf — split on first separator.
      // The modelId portion can itself contain colons (e.g., versioned ids).
      expect(unpackModelId('conn:model:with:colons')).toEqual({
        connectionId: 'conn',
        modelId: 'model:with:colons',
      })
    })

    test('compose → unpack round-trip preserves the input', () => {
      const packed = composeModelId('claude-account', 'claude-opus-4-7')
      const unpacked = unpackModelId(packed)
      expect(unpacked.connectionId).toBe('claude-account')
      expect(unpacked.modelId).toBe('claude-opus-4-7')
    })
  })
})
