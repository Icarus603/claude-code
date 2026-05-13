import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pins for `mcpInstructionsDelta.ts` — the diff algorithm
 * that decides which MCP server instructions to announce on each turn.
 *
 * Critical invariants worth pinning:
 *  1. Env override CLAUDE_CODE_MCP_INSTR_DELTA wins over both `USER_TYPE=ant`
 *     AND the GrowthBook gate `tengu_basalt_3kr`. Order matters: truthy first
 *     (early-return true), falsy second (early-return false), then default.
 *  2. Default-enabled paths: `USER_TYPE === 'ant'` OR GrowthBook gate.
 *  3. Diff key is server NAME (instructions are immutable per connection;
 *     content diff would be wrong).
 *  4. Output is null when nothing changed (caller treats null = no-op).
 *  5. Block format: `## ${name}\n${instructions}` for server-authored;
 *     client-side gets appended with `\n\n` separator if both present.
 *  6. Telemetry name `tengu_mcp_instructions_pool_change` matches ant's
 *     dashboard query.
 *  7. addedNames are sorted alphabetically; removedNames also sorted.
 */
describe('mcpInstructionsDelta — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'mcpInstructionsDelta.ts'),
    'utf-8',
  )

  describe('isMcpInstructionsDeltaEnabled — gate ordering', () => {
    test('CLAUDE_CODE_MCP_INSTR_DELTA truthy → return true (highest priority)', () => {
      expect(source).toMatch(
        /if \(isEnvTruthy\(process\.env\.CLAUDE_CODE_MCP_INSTR_DELTA\)\) return true/,
      )
    })

    test('CLAUDE_CODE_MCP_INSTR_DELTA defined-falsy → return false (second priority)', () => {
      // Pin: defined-falsy (0, false, no, off), NOT just !truthy. Caller
      // explicitly setting `=false` MUST disable even if USER_TYPE=ant.
      expect(source).toMatch(
        /if \(isEnvDefinedFalsy\(process\.env\.CLAUDE_CODE_MCP_INSTR_DELTA\)\) return false/,
      )
    })

    test('default: USER_TYPE=ant OR GrowthBook tengu_basalt_3kr', () => {
      // Pin: ant build defaults ON. Public ccb defaults to GrowthBook value.
      expect(source).toMatch(
        /process\.env\.USER_TYPE === 'ant' \|\|\s*\n?\s*getFeatureValue_CACHED_MAY_BE_STALE\('tengu_basalt_3kr', false\)/,
      )
    })

    test('GrowthBook default is FALSE (off by default in ccb)', () => {
      // Pin: `false` as the second arg — feature defaults off.
      expect(source).toMatch(
        /'tengu_basalt_3kr', false/,
      )
    })

    test('gate priority order: truthy → falsy → ant/growthbook', () => {
      const fn = source.match(
        /export function isMcpInstructionsDeltaEnabled[\s\S]+?\n\}/,
      )?.[0]
      expect(fn).toBeTruthy()
      // Position check: truthy line < falsy line < return line.
      const truthyIdx = fn!.indexOf("isEnvTruthy(process.env.CLAUDE_CODE_MCP_INSTR_DELTA)")
      const falsyIdx = fn!.indexOf("isEnvDefinedFalsy(process.env.CLAUDE_CODE_MCP_INSTR_DELTA)")
      const antIdx = fn!.indexOf("USER_TYPE === 'ant'")
      expect(truthyIdx).toBeGreaterThan(-1)
      expect(falsyIdx).toBeGreaterThan(truthyIdx)
      expect(antIdx).toBeGreaterThan(falsyIdx)
    })
  })

  describe('getMcpInstructionsDelta — algorithm', () => {
    test('iterates messages and accumulates announced from delta attachments', () => {
      expect(source).toMatch(
        /if \(msg\.attachment\.type !== 'mcp_instructions_delta'\) continue/,
      )
    })

    test('updates announced via delta.addedNames AND delta.removedNames', () => {
      // Pin: both directions of the delta must be replayed to compute
      // current state from message history.
      expect(source).toMatch(/for \(const n of delta\.addedNames\) announced\.add\(n\)/)
      expect(source).toMatch(
        /for \(const n of delta\.removedNames\) announced\.delete\(n\)/,
      )
    })

    test('connected filter narrows to type === "connected"', () => {
      // Pin: failed / disconnected servers DON\'T announce instructions.
      expect(source).toMatch(
        /mcpClients\.filter\(\s*\n?\s*\(c\): c is ConnectedMCPServer => c\.type === 'connected',/,
      )
    })

    test('server-authored block format: "## ${name}\\n${instructions}"', () => {
      expect(source).toMatch(
        /blocks\.set\(c\.name, `## \$\{c\.name\}\\n\$\{c\.instructions\}`\)/,
      )
    })

    test('client-side instruction APPENDS to existing block with double newline', () => {
      // Pin: when a server has BOTH server-authored + client-side, they
      // get concatenated with \n\n. A regression to single \n would run
      // them together in the prompt.
      expect(source).toMatch(
        /existing\s*\n?\s*\?\s*`\$\{existing\}\\n\\n\$\{ci\.block\}`/,
      )
    })

    test('client-side ONLY (no server instructions) gets "## ${name}\\n${block}" form', () => {
      // Pin: same shape as server-authored when no existing block.
      expect(source).toMatch(
        /:\s*`## \$\{ci\.serverName\}\\n\$\{ci\.block\}`/,
      )
    })

    test('client-side instruction SKIPPED if server is not currently connected', () => {
      // Pin: ci with no live connection is dropped (can\'t announce
      // instructions for a server that isn\'t there).
      expect(source).toMatch(
        /if \(!connectedNames\.has\(ci\.serverName\)\) continue/,
      )
    })

    test('addedNames sorted alphabetically (deterministic delta order)', () => {
      // Pin: deterministic output → testable + prompt cache friendly.
      expect(source).toMatch(/added\.sort\(\(a, b\) => a\.name\.localeCompare\(b\.name\)\)/)
    })

    test('removedNames also sorted alphabetically', () => {
      expect(source).toMatch(/removedNames: removed\.sort\(\)/)
    })

    test('returns null when nothing changed (no-op signal)', () => {
      expect(source).toMatch(
        /if \(added\.length === 0 && removed\.length === 0\) return null/,
      )
    })

    test('telemetry event name: tengu_mcp_instructions_pool_change', () => {
      // Pin: matches ant\'s dashboard query.
      expect(source).toMatch(/'tengu_mcp_instructions_pool_change'/)
    })

    test('telemetry payload includes priorAnnouncedCount and clientSideCount', () => {
      // Pin: diagnostic fields for "delta scan failed in prod" debugging.
      expect(source).toMatch(/priorAnnouncedCount: announced\.size/)
      expect(source).toMatch(
        /clientSideCount: clientSideInstructions\.length/,
      )
    })

    test('telemetry payload includes attachmentCount + midCount (scan diagnostics)', () => {
      // Pin: lets prod investigation distinguish "no attachments in
      // messages" from "delta attachments missed".
      expect(source).toMatch(/attachmentCount,\s*\n?\s*midCount/)
    })
  })

  describe('exports', () => {
    test('McpInstructionsDelta + ClientSideInstruction types exported', () => {
      expect(source).toMatch(/^export type McpInstructionsDelta = \{/m)
      expect(source).toMatch(/^export type ClientSideInstruction = \{/m)
    })

    test('isMcpInstructionsDeltaEnabled exported (caller in prompts.ts)', () => {
      expect(source).toMatch(/^export function isMcpInstructionsDeltaEnabled/m)
    })

    test('getMcpInstructionsDelta exported', () => {
      expect(source).toMatch(/^export function getMcpInstructionsDelta/m)
    })
  })
})
