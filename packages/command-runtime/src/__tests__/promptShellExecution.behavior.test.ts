import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pins for `promptShellExecution.ts` — executes shell
 * commands embedded in slash command markdown. Two syntaxes:
 *   1. Block: ```! command ```
 *   2. Inline: !`command`
 *
 * Critical invariants:
 *  1. BLOCK_PATTERN: /```!\s*\n?([\s\S]*?)\n?```/g — global, multi-line.
 *  2. INLINE_PATTERN uses positive lookbehind (?<=^|\s)!`...` so the
 *     inline marker requires whitespace or line-start before !. This
 *     prevents false matches inside markdown spans like `!!`, `foo`!`bar`,
 *     or shell vars like $!.
 *  3. INLINE_PATTERN scanning is GATED behind text.includes('!`') because
 *     the lookbehind is ~100x slower (265µs vs 2µs @ 17KB).
 *  4. Default shell is bash. PowerShell ONLY when frontmatter shell ===
 *     'powershell' AND runtime gate `isPowerShellToolEnabled()` allows.
 *     A skill author's choice DOES NOT override user opt-in.
 *  5. PowerShellTool is loaded via LAZY require (cached on first call)
 *     to avoid startup-time import.
 *  6. Replacement uses a FUNCTION replacer: result.replace(match[0], () =>
 *     output). Shell output is arbitrary user data — bare string would
 *     get $$/$&/$`/$' substitution.
 *  7. Permission check FIRST. If not 'allow', throw MalformedCommandError.
 *  8. MalformedCommandError re-thrown (NOT caught and reformatted).
 */
describe('promptShellExecution — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'promptShellExecution.ts'),
    'utf-8',
  )

  describe('Regex patterns', () => {
    test('BLOCK_PATTERN: /```!\\s*\\n?([\\s\\S]*?)\\n?```/g', () => {
      // Pin: leading `!` REQUIRED. ```bash without ! must NOT match.
      // \s*\n? tolerates optional whitespace + newline before content.
      expect(source).toMatch(
        /BLOCK_PATTERN = \/`{3}!\\s\*\\n\?\(\[\\s\\S\]\*\?\)\\n\?`{3}\/g/,
      )
    })

    test('INLINE_PATTERN uses positive lookbehind (?<=^|\\s)', () => {
      // Pin: lookbehind is the load-bearing piece. False positives in
      // markdown spans were a real bug fixed in this format.
      expect(source).toMatch(
        /INLINE_PATTERN = \/\(\?<=\^\|\\s\)!`\(\[\^`\]\+\)`\/gm/,
      )
    })

    test('lookbehind has eslint-disable + PR reference comment', () => {
      // Pin: the comment documents why this regex breaks the lint rule.
      // A regression that drops the comment would draw lint noise; a
      // regression that drops the gate (text.includes('!`')) would
      // perf-regress.
      expect(source).toMatch(
        /eslint-disable-next-line[\s\S]{0,100}?no-lookbehind-regex[\s\S]{0,200}?gated by text\.includes/,
      )
    })

    test('Inline scanning gated by text.includes("!`") cheap precheck', () => {
      // Pin: avoids 265µs lookbehind cost on the 93% of skills with no !`.
      expect(source).toMatch(/text\.includes\('!`'\) \? text\.matchAll/)
    })
  })

  describe('Shell selection', () => {
    test('default shell is BashTool (bash || undefined → BashTool)', () => {
      // Pin: undefined frontmatter shell → bash. Both undefined and
      // 'bash' hit the same tool.
      expect(source).toMatch(
        /shell === 'powershell' && isPowerShellToolEnabled\(\)\s*\n?\s*\?\s*getPowerShellTool\(\)\s*\n?\s*:\s*BashTool/,
      )
    })

    test('PowerShell gate: BOTH frontmatter === "powershell" AND runtime opt-in', () => {
      // Pin: skill author's choice does NOT override user. AND, not OR.
      expect(source).toMatch(
        /shell === 'powershell' && isPowerShellToolEnabled\(\)/,
      )
    })

    test('PowerShellTool import is LAZY (require, cached)', () => {
      // Pin: cached on first call to avoid pulling powershell module
      // into startup.
      expect(source).toMatch(
        /const getPowerShellTool = \(\(\) => \{\s*\n?\s*let cached:[\s\S]+?if \(!cached\)/,
      )
    })

    test('PowerShellTool deferred reason documented in comment', () => {
      // Pin: the comment says WHY this is lazy. Removing the comment
      // doesn't break behavior but losing the reason makes the gating
      // brittle to refactoring.
      expect(source).toMatch(
        /startup import chain[\s\S]{0,300}?defeating tools\.ts's lazy require/,
      )
    })
  })

  describe('Permission gate', () => {
    test('hasPermissionsToUseTool called BEFORE shellTool.call', () => {
      // Pin: permission check FIRST. A regression that orders the call
      // first would execute commands before the user can deny them.
      const permissionIdx = source.indexOf('hasPermissionsToUseTool')
      const callIdx = source.indexOf('shellTool.call')
      expect(permissionIdx).toBeGreaterThan(-1)
      expect(callIdx).toBeGreaterThan(permissionIdx)
    })

    test('permissionResult.behavior !== "allow" → throw MalformedCommandError', () => {
      expect(source).toMatch(
        /if \(permissionResult\.behavior !== 'allow'\) \{[\s\S]+?throw new MalformedCommandError/,
      )
    })

    test('permission denial message includes pattern + reason', () => {
      // Pin: error surface must include the original pattern (e.g., the
      // !`...` form) so the user knows which command was denied.
      expect(source).toMatch(
        /Shell command permission check failed for pattern[\s\S]{0,40}?match\[0\]/,
      )
    })
  })

  describe('Output substitution', () => {
    test('result.replace uses FUNCTION replacer (NOT bare string)', () => {
      // Pin: shell output is arbitrary user data — $$ etc. would be
      // interpolated by String.replace if passed as string. Wrap in `() =>
      // output` to bypass interpolation.
      expect(source).toMatch(
        /result\.replace\(match\[0\], \(\) => output\)/,
      )
    })

    test('output: tool result block content OR formatBashOutput(stdout, stderr)', () => {
      // Pin: prefers tool-result block (when it persists), falls back
      // to inline stdout+stderr formatting.
      expect(source).toMatch(
        /toolResultBlock\.content[\s\S]+?:\s*formatBashOutput\(data\.stdout, data\.stderr\)/,
      )
    })

    test('MalformedCommandError re-thrown without reformat', () => {
      // Pin: avoid double-wrapping. A regression that wraps with
      // formatBashError would lose the original permission/command error.
      expect(source).toMatch(
        /if \(e instanceof MalformedCommandError\) \{\s*\n?\s*throw e\s*\n?\s*\}/,
      )
    })
  })

  describe('formatBashOutput', () => {
    test('only stdout shown when stderr is empty', () => {
      // Pin: trim()-empty stderr means no [stderr] decoration.
      expect(source).toMatch(/if \(stderr\.trim\(\)\) \{/)
    })

    test('inline mode joins with single space + [stderr: ...] form', () => {
      expect(source).toMatch(/\[stderr: \$\{stderr\.trim\(\)\}\]/)
    })

    test('block mode uses newline-prefixed [stderr]\\n form', () => {
      expect(source).toMatch(/`\[stderr\]\\n\$\{stderr\.trim\(\)\}`/)
    })

    test('parts join: inline → " ", block → "\\n"', () => {
      expect(source).toMatch(/parts\.join\(inline \? ' ' : '\\n'\)/)
    })
  })

  describe('formatBashError', () => {
    test('interrupted → "[Command interrupted]" message', () => {
      expect(source).toMatch(/\[Command interrupted\]/)
    })

    test('formatBashError signature returns `never` (always throws)', () => {
      // Pin: caller can rely on this being a throw, not a fall-through.
      expect(source).toMatch(
        /formatBashError\(e: unknown, pattern: string, inline = false\): never/,
      )
    })

    test('all error branches throw MalformedCommandError (NOT raw Error)', () => {
      // Pin: caller's catch chain expects MalformedCommandError.
      const fn = source.match(
        /function formatBashError[\s\S]+?\n\}/,
      )?.[0]
      expect(fn).toBeTruthy()
      const throwCount = (fn!.match(/throw new MalformedCommandError/g) ?? [])
        .length
      // Pin: 3 throw sites — interrupted, ShellError, fallback.
      expect(throwCount).toBe(3)
    })
  })
})
