import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for firstParty + Codex + AnthropicCompatible client
 * dispatch logic in anthropic/client.ts.
 *
 * V7 §11.6 — connection registry resolves at construction time, NOT at
 * call time. The same query() invocation must route to the same client
 * for the lifetime of that turn.
 *
 * Three sub-modes to pin:
 *   1. Codex (chatgpt.com backend) → custom fetch adapter (translates
 *      Anthropic-shape bodies to /responses shape)
 *   2. AnthropicCompatible (api_key auth, user endpoint) → set baseURL +
 *      apiKey from connection record, DELETE OAuth Bearer header
 *   3. Default firstParty → apiKey + authToken from authCredentials
 */
describe('firstParty / Codex / Anthropic-compat client dispatch', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'anthropic', 'client.ts'),
    'utf-8',
  )

  describe('Codex routing seam (V7 §11.6)', () => {
    test('triggered by conn.protocol === "codex" && conn.auth.type === "oauth"', () => {
      expect(source).toMatch(
        /if\s*\(conn\?\.protocol === 'codex' && conn\.auth\.type === 'oauth'\)/,
      )
    })

    test('installs custom fetch via createCodexFetch (translation adapter)', () => {
      expect(source).toMatch(
        /createCodexFetch\(\)/,
      )
    })

    test('apiKey is a placeholder string (SDK requires non-empty, fetch adapter does real auth)', () => {
      // Pin: the placeholder string must be non-empty (SDK validates) but
      // never sent on the wire (fetch adapter intercepts). A "let's use ''"
      // refactor would crash construction.
      expect(source).toMatch(/apiKey:\s*'codex-via-fetch-adapter'/)
    })
  })

  describe('Anthropic-compatible connection', () => {
    test('detects via conn.protocol === "anthropic" && conn.auth.type === "api_key"', () => {
      expect(source).toMatch(
        /useCompatibleConn\s*=\s*\n?\s*conn\?\.protocol === 'anthropic' && conn\.auth\.type === 'api_key'/,
      )
    })

    test('uses connection endpoint as baseURL when present', () => {
      expect(source).toMatch(
        /useCompatibleConn[\s\S]*?conn\?\.endpoint[\s\S]*?\{ baseURL:\s*conn\.endpoint \}/,
      )
    })

    test('CRITICAL: drops OAuth Authorization header so proxy doesn\'t see double auth', () => {
      // If both Authorization (Bearer OAuth) AND x-api-key go to a
      // proxy, the proxy gets confused — often signs the wrong direction
      // or rejects with "multiple auth methods". Pin the delete.
      expect(source).toMatch(
        /delete clientConfig\.defaultHeaders\?\.\['Authorization'\]/,
      )
    })

    test('apiKey from connection (NOT from authCredentials) when useCompatibleConn', () => {
      expect(source).toMatch(
        /apiKey: useCompatibleConn[\s\S]{0,200}conn\.auth\.key/,
      )
    })
  })

  describe('default firstParty branch', () => {
    test('uses authCredentials.apiKey and authCredentials.authToken', () => {
      expect(source).toMatch(/authCredentials\.apiKey/)
      expect(source).toMatch(/authCredentials\.authToken/)
    })

    test('honors authCredentials.baseURL override (e.g., custom endpoint)', () => {
      expect(source).toMatch(
        /authCredentials\.baseURL\s*\n?\s*\?\s*\{ baseURL:\s*authCredentials\.baseURL \}/,
      )
    })
  })

  describe('connection resolution', () => {
    test('resolveConnectionForModel called with the active model', () => {
      expect(source).toMatch(/resolveConnectionForModel\(model\)/)
    })

    test('lazy require to avoid circular import (V7 §11.6 boundary)', () => {
      // Direct import would create circular dep between client.ts and
      // providers.ts. Pin the require(...) form so the cycle stays broken.
      expect(source).toMatch(
        /require\(\s*\n?\s*'\.\.\/providers\.js',?\s*\n?\s*\)/,
      )
    })
  })
})
