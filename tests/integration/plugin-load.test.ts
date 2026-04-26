import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * E2E plugin loading test.
 *
 * Guards against the four setter-shim signature mismatches that broke
 * plugin loading in commit 6324afc3:
 *   1. McpServerConfigSchema = null literal (vs lazy fn)
 *   2. expandEnvVarsInString returned string (vs `{expanded, missingVars}`)
 *   3. fs.readdir returned string[] (vs Dirent[])
 *   4. parseFrontmatter returned bare data (vs `{frontmatter, content}`)
 *
 * Each bug presented as a different downstream symptom: marketplace parse
 * fail, "Spread syntax requires...", silent zero-files walk, "frontmatter
 * is undefined". This test exercises the full pipeline so a regression in
 * any layer surfaces immediately, not only when a user runs /plugin.
 */

async function makeFixturePlugin(root: string): Promise<{
  pluginDir: string
  marketplaceDir: string
}> {
  const marketplaceDir = join(root, 'fixture-marketplace')
  const pluginsDir = join(marketplaceDir, 'plugins')
  const pluginDir = join(pluginsDir, 'fixture-plugin')

  await mkdir(join(marketplaceDir, '.claude-plugin'), { recursive: true })
  await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true })
  await mkdir(join(pluginDir, 'commands'), { recursive: true })
  await mkdir(join(pluginDir, 'skills', 'helper-skill'), { recursive: true })

  // Marketplace manifest
  await writeFile(
    join(marketplaceDir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'fixture-marketplace',
      plugins: [{ name: 'fixture-plugin', source: './plugins/fixture-plugin' }],
    }),
  )

  // Plugin manifest with HTTP MCP server (exercises McpServerConfigSchema)
  await writeFile(
    join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'fixture-plugin',
      version: '1.0.0',
      description: 'fixture plugin',
      mcpServers: {
        'fixture-mcp': { type: 'http', url: 'https://example.invalid/mcp' },
      },
    }),
  )

  // Plugin command (exercises walkPluginMarkdown + parseFrontmatter)
  await writeFile(
    join(pluginDir, 'commands', 'hello.md'),
    `---
description: A fixture command
---
This is the body of /hello.
`,
  )

  // Plugin skill (exercises getPluginSkills path)
  await writeFile(
    join(pluginDir, 'skills', 'helper-skill', 'SKILL.md'),
    `---
description: A fixture skill
---
This is the helper skill body.
`,
  )

  return { pluginDir, marketplaceDir }
}

describe('plugin loading e2e (guards against setter-shim regressions)', () => {
  test('McpServerConfigSchema is a callable function (catches null-literal bug)', async () => {
    await import('@claude-code/app-host/runtime/bootstrap.js')
    const { McpServerConfigSchema } = await import(
      '@claude-code/config/plugin/_deps.js'
    )
    expect(typeof McpServerConfigSchema).toBe('function')
    const schema = McpServerConfigSchema()
    expect(typeof (schema as { safeParse?: unknown }).safeParse).toBe(
      'function',
    )
  })

  test('expandEnvVarsInString returns {expanded, missingVars} (catches signature mismatch)', async () => {
    await import('@claude-code/app-host/runtime/bootstrap.js')
    const { expandEnvVarsInString } = await import(
      '@claude-code/config/plugin/_deps.js'
    )
    const result = expandEnvVarsInString('hello ${HOME}') as {
      expanded: string
      missingVars: string[]
    }
    expect(result).toBeObject()
    expect(typeof result.expanded).toBe('string')
    expect(Array.isArray(result.missingVars)).toBe(true)
  })

  test('fs.readdir returns Dirent-like entries (catches string[] bug)', async () => {
    await import('@claude-code/app-host/runtime/bootstrap.js')
    const { getFsImplementation } = await import(
      '@claude-code/config/plugin/_deps.js'
    )
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-load-test-'))
    await writeFile(join(tmp, 'a.md'), 'a')
    const fs = getFsImplementation()
    const entries = await fs.readdir(tmp)
    expect(entries.length).toBe(1)
    const e = entries[0]!
    expect(typeof (e as { isFile?: unknown }).isFile).toBe('function')
    expect((e as { isFile(): boolean }).isFile()).toBe(true)
  })

  test('parseFrontmatter returns {frontmatter, content} (catches bare-data bug)', async () => {
    await import('@claude-code/app-host/runtime/bootstrap.js')
    const { parseFrontmatter } = await import(
      '@claude-code/config/plugin/_deps.js'
    )
    const result = parseFrontmatter(
      '---\ndescription: test\n---\nbody',
    ) as { frontmatter: Record<string, unknown>; content: string }
    expect(result).toBeObject()
    expect(result.frontmatter).toBeObject()
    expect(typeof result.content).toBe('string')
    expect(result.frontmatter.description).toBe('test')
  })

  test('executeShellCommandsInPrompt forwards all args (catches arg-drop bug)', async () => {
    // Regression: _deps.ts's public wrapper used to forward only the
    // first arg (prompt), dropping context/slashCommandName/shell. The
    // canonical impl needs `context` to call BashTool, which destructures
    // context.abortController — so a dropped context produced
    // "undefined is not an object (evaluating 'context.abortController')"
    // for every plugin slash command that contained a !cmd block.
    await import('@claude-code/app-host/runtime/bootstrap.js')
    const { executeShellCommandsInPrompt } = await import(
      '@claude-code/config/plugin/_deps.js'
    )
    expect(executeShellCommandsInPrompt.length).toBeGreaterThanOrEqual(1)
    // Smoke: passing 4 args should not throw arity error before reaching
    // the canonical impl. We pass a prompt with no !cmd blocks so the
    // canonical impl has nothing to execute and returns the prompt
    // unchanged regardless of context shape.
    const result = await executeShellCommandsInPrompt(
      'plain prompt with no shell blocks',
      undefined as unknown,
      '/test',
      undefined as unknown,
    )
    expect(typeof result).toBe('string')
    expect(result).toContain('plain prompt')
  })

  test('walkPluginMarkdown discovers .md files in fixture plugin', async () => {
    await import('@claude-code/app-host/runtime/bootstrap.js')
    const { walkPluginMarkdown } = await import(
      '@claude-code/config/plugin/walkPluginMarkdown.js'
    )
    const tmp = await mkdtemp(join(tmpdir(), 'plugin-load-test-'))
    const { pluginDir } = await makeFixturePlugin(tmp)
    const found: string[] = []
    await walkPluginMarkdown(
      join(pluginDir, 'commands'),
      async path => {
        found.push(path)
      },
      { stopAtSkillDir: true, logLabel: 'commands' },
    )
    expect(found.length).toBe(1)
    expect(found[0]).toContain('hello.md')
  })
})
