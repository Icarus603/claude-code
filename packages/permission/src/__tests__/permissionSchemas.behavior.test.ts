import { describe, expect, test } from 'bun:test'

import {
  permissionBehaviorSchema,
  permissionRuleValueSchema,
} from '../PermissionRule.ts'
import {
  permissionUpdateDestinationSchema,
  permissionUpdateSchema,
} from '../PermissionUpdateSchema.ts'

/**
 * Pin Zod schemas for permission rules and updates. These are the
 * wire format for settings files (`.claude/settings.json`) and CLI
 * args. A regression that widens or narrows the enum silently breaks
 * forwards/backwards compat with shipped settings files.
 *
 * Pinned invariants:
 *  1. permissionBehaviorSchema accepts EXACTLY 'allow' | 'deny' | 'ask'
 *     (no 'prompt' or 'manual' even though both have been considered).
 *  2. permissionRuleValueSchema requires toolName, ruleContent optional.
 *  3. permissionUpdateDestinationSchema accepts EXACTLY 5 destinations.
 *  4. permissionUpdateSchema discriminates on `type` over 6 update kinds.
 *  5. addRules/replaceRules/removeRules carry `behavior` + `rules`.
 *  6. setMode carries `mode` (external permission mode).
 *  7. addDirectories/removeDirectories carry `directories` (string[]).
 */
describe('permission schemas (Zod wire-format pins)', () => {
  describe('permissionBehaviorSchema', () => {
    test('accepts allow/deny/ask (the 3 canonical behaviors)', () => {
      expect(permissionBehaviorSchema().parse('allow')).toBe('allow')
      expect(permissionBehaviorSchema().parse('deny')).toBe('deny')
      expect(permissionBehaviorSchema().parse('ask')).toBe('ask')
    })

    test('rejects "prompt" (commonly considered alias — must use "ask")', () => {
      // Pin: prompt is NOT a behavior. A regression that accepts it
      // would let invalid settings files load silently.
      expect(() => permissionBehaviorSchema().parse('prompt')).toThrow()
    })

    test('rejects "manual" / "auto" / "" / undefined', () => {
      expect(() => permissionBehaviorSchema().parse('manual')).toThrow()
      expect(() => permissionBehaviorSchema().parse('auto')).toThrow()
      expect(() => permissionBehaviorSchema().parse('')).toThrow()
      expect(() => permissionBehaviorSchema().parse(undefined)).toThrow()
    })

    test('case-sensitive: ALLOW / Allow rejected', () => {
      // Pin: settings file MUST be exact lowercase.
      expect(() => permissionBehaviorSchema().parse('ALLOW')).toThrow()
      expect(() => permissionBehaviorSchema().parse('Allow')).toThrow()
    })
  })

  describe('permissionRuleValueSchema', () => {
    test('toolName required (no toolName → reject)', () => {
      expect(() =>
        permissionRuleValueSchema().parse({ ruleContent: 'x' }),
      ).toThrow()
    })

    test('ruleContent optional (toolName-only rule passes)', () => {
      // Pin: a bare "Bash" rule matches every Bash invocation; this is
      // the common case. ruleContent narrows.
      const result = permissionRuleValueSchema().parse({ toolName: 'Bash' })
      expect(result.toolName).toBe('Bash')
      expect(result.ruleContent).toBeUndefined()
    })

    test('toolName + ruleContent shape (the precise-match form)', () => {
      const result = permissionRuleValueSchema().parse({
        toolName: 'Bash',
        ruleContent: 'ls *',
      })
      expect(result).toEqual({ toolName: 'Bash', ruleContent: 'ls *' })
    })

    test('toolName must be string (number rejected)', () => {
      expect(() =>
        permissionRuleValueSchema().parse({ toolName: 42 }),
      ).toThrow()
    })
  })

  describe('permissionUpdateDestinationSchema', () => {
    test('accepts exactly 5 destinations', () => {
      // Pin: the 5 known scopes. Settings layering hardcodes this.
      const destinations = [
        'userSettings',
        'projectSettings',
        'localSettings',
        'session',
        'cliArg',
      ]
      for (const d of destinations) {
        expect(permissionUpdateDestinationSchema().parse(d)).toBe(d)
      }
    })

    test('rejects "global" / "remote" / typos', () => {
      // Pin: "global" is a common typo for "userSettings".
      expect(() =>
        permissionUpdateDestinationSchema().parse('global'),
      ).toThrow()
      expect(() =>
        permissionUpdateDestinationSchema().parse('remote'),
      ).toThrow()
      expect(() =>
        permissionUpdateDestinationSchema().parse('user'),
      ).toThrow()
    })
  })

  describe('permissionUpdateSchema (discriminated union)', () => {
    test('addRules update with behavior + destination', () => {
      const result = permissionUpdateSchema().parse({
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'ls *' }],
        behavior: 'allow',
        destination: 'session',
      })
      expect(result.type).toBe('addRules')
    })

    test('replaceRules accepted', () => {
      const result = permissionUpdateSchema().parse({
        type: 'replaceRules',
        rules: [],
        behavior: 'deny',
        destination: 'projectSettings',
      })
      expect(result.type).toBe('replaceRules')
    })

    test('removeRules accepted', () => {
      const result = permissionUpdateSchema().parse({
        type: 'removeRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'allow',
        destination: 'userSettings',
      })
      expect(result.type).toBe('removeRules')
    })

    test('setMode update carries `mode` (NOT `behavior`)', () => {
      // Pin: setMode is structurally different — it sets the runtime
      // permission mode (default/plan/acceptEdits/bypassPermissions),
      // not a rule behavior.
      const result = permissionUpdateSchema().parse({
        type: 'setMode',
        mode: 'plan',
        destination: 'session',
      })
      expect(result.type).toBe('setMode')
    })

    test('addDirectories carries `directories` string array', () => {
      const result = permissionUpdateSchema().parse({
        type: 'addDirectories',
        directories: ['/tmp/x', '/tmp/y'],
        destination: 'session',
      })
      expect(result.type).toBe('addDirectories')
    })

    test('removeDirectories carries `directories` string array', () => {
      const result = permissionUpdateSchema().parse({
        type: 'removeDirectories',
        directories: ['/tmp/x'],
        destination: 'projectSettings',
      })
      expect(result.type).toBe('removeDirectories')
    })

    test('unknown `type` rejected (no fallback)', () => {
      expect(() =>
        permissionUpdateSchema().parse({
          type: 'unknownType',
          rules: [],
          behavior: 'allow',
          destination: 'session',
        }),
      ).toThrow()
    })

    test('addRules with wrong destination → rejected', () => {
      expect(() =>
        permissionUpdateSchema().parse({
          type: 'addRules',
          rules: [{ toolName: 'Bash' }],
          behavior: 'allow',
          destination: 'bogusSettings',
        }),
      ).toThrow()
    })

    test('addRules without `behavior` → rejected (required field)', () => {
      expect(() =>
        permissionUpdateSchema().parse({
          type: 'addRules',
          rules: [{ toolName: 'Bash' }],
          destination: 'session',
        }),
      ).toThrow()
    })
  })
})
