import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// namedWorkflows.ts (ant 3889 DHK/MHK + 3890 O0_/xMH) discovers `.js` workflow
// files under ~/.claude/workflows, parses their `meta`, merges builtin + dir
// workflows by name, and resolves by name.
//
// We drive the USER directory through a REAL temp filesystem pointed at by the
// CLAUDE_CONFIG_DIR env var (getClaudeConfigHomeDir reads it, memoized-keyed off
// it). NO module mocks — bun's mock.module is global for the whole run and an fs
// or config stub leaks into unrelated suites (projectPurge etc.). Project-dir
// and settings-gate paths need shared-module mocks to drive, so they're covered
// by the engine/integration layer, not here; this suite locks the file loader,
// the meta-skip rules, the builtin merge, and resolve — the bug-prone parser/
// merge logic.

let configDir = ''
let prevConfigDir: string | undefined

function userWorkflowsDir(): string {
  return join(configDir, 'workflows')
}
function writeWf(file: string, content: string): void {
  mkdirSync(userWorkflowsDir(), { recursive: true })
  writeFileSync(join(userWorkflowsDir(), file), content)
}
function wf(name: string, body = 'log("hi")'): string {
  return `export const meta = { name: ${JSON.stringify(name)}, description: ${JSON.stringify(name + ' desc')} }\n${body}`
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'wf-cfg-'))
  prevConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = configDir
})
afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
  rmSync(configDir, { recursive: true, force: true })
})

async function load() {
  const mod = await import('../namedWorkflows.js')
  mod.clearNamedWorkflowsCache()
  return mod
}

describe('namedWorkflows — user-dir discovery', () => {
  test('loads .js workflows from the user dir', async () => {
    writeWf('a.js', wf('alpha_wf'))
    const { listAllNamedWorkflows } = await load()
    const alpha = (await listAllNamedWorkflows()).find(w => w.name === 'alpha_wf')
    expect(alpha).toBeDefined()
    expect(alpha!.source).toBe('userSettings')
    expect(alpha!.description).toBe('alpha_wf desc')
  })

  test('skips non-.js, oversized, and invalid-meta files', async () => {
    writeWf('ok.js', wf('good_unique_name'))
    writeWf('readme.md', 'not js')
    writeWf(
      'huge.js',
      `export const meta={name:"big_wf",description:"d"}\n${'x'.repeat(524_289)}`,
    )
    writeWf('bad.js', 'no meta export here')
    const { listAllNamedWorkflows } = await load()
    const names = (await listAllNamedWorkflows()).map(w => w.name)
    expect(names).toContain('good_unique_name')
    expect(names).not.toContain('big_wf')
    // 'readme.md' (non-.js) and 'bad.js' (no meta) never appear.
    expect(names.some(n => n.includes('readme'))).toBe(false)
  })

  test('empty / missing workflows dir → no throw, empty (plus any builtins)', async () => {
    const { listAllNamedWorkflows } = await load()
    const fromDir = (await listAllNamedWorkflows()).filter(
      w => w.source !== 'built-in',
    )
    expect(fromDir).toEqual([])
  })
})

describe('namedWorkflows — builtin merge + resolve', () => {
  test('builtin appears, but a same-name dir workflow shadows it', async () => {
    writeWf('shared.js', wf('shared_wf', 'log("dir")'))
    const {
      registerBuiltinWorkflow,
      resolveNamedWorkflow,
      listAllNamedWorkflows,
    } = await load()
    registerBuiltinWorkflow(
      { name: 'shared_wf', description: 'builtin' },
      'log("builtin")',
    )
    registerBuiltinWorkflow(
      { name: 'only_builtin_wf', description: 'b' },
      'log("b")',
    )
    const all = await listAllNamedWorkflows()
    expect(all.find(w => w.name === 'only_builtin_wf')?.source).toBe('built-in')
    // dir entry wins over the same-name builtin
    expect((await resolveNamedWorkflow('shared_wf'))?.script).toContain(
      'log("dir")',
    )
  })

  test('resolveNamedWorkflow returns null for an unknown name', async () => {
    const { resolveNamedWorkflow } = await load()
    expect(await resolveNamedWorkflow('no_such_wf_xyz')).toBeNull()
  })

  test('listNamedWorkflowNames returns names-only entries', async () => {
    writeWf('a.js', wf('names_only_wf'))
    const { listNamedWorkflowNames } = await load()
    const names = await listNamedWorkflowNames()
    expect(names).toContainEqual({ name: 'names_only_wf' })
    for (const entry of names) expect(Object.keys(entry)).toEqual(['name'])
  })
})
