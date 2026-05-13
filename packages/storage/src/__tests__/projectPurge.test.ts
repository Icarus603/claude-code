/**
 * Tests for projectPurge.ts — byte-for-byte port of ant v2.1.136
 *   - `ci3` → collectProjectPurgeItems
 *   - `li3` → collectAllProjectsPurgeItems
 *   - `Id8` → executePurgeItem
 *   - `xd8` → scanHistoryFile
 *
 * Strategy: build an isolated CLAUDE_CONFIG_DIR per-test, point env so
 * `getClaudeConfigHomeDir()` lands inside the tmpdir, populate the
 * canonical layout (projects/, tasks/, debug/, file-history/, .claude.json,
 * history.jsonl), then assert what collectProjectPurgeItems / scanHistoryFile
 * pick up — both shape and per-item kind/reason.
 *
 * scanHistoryFile is the high-bug-density helper (string parsing, async
 * iterator, file rewrite). Get its filter/count modes pinned hard.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  collectAllProjectsPurgeItems,
  collectProjectPurgeItems,
  executePurgeItem,
  scanHistoryFile,
} from '../projectPurge.js'

let claudeHome: string
let origEnv: string | undefined

beforeEach(() => {
  origEnv = process.env.CLAUDE_CONFIG_DIR
  claudeHome = mkdtempSync(join(tmpdir(), 'ccb-purge-test-'))
  // getClaudeConfigHomeDir() reads CLAUDE_CONFIG_DIR.
  process.env.CLAUDE_CONFIG_DIR = claudeHome
})

afterEach(() => {
  if (origEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = origEnv
  rmSync(claudeHome, { recursive: true, force: true })
})

function setupClaudeJson(projects: Record<string, unknown>): void {
  // ant `.claude.json` lives at ~/.claude/../.claude.json — i.e. one
  // level UP from CLAUDE_CONFIG_DIR. Place it accordingly so our
  // readClaudeJsonProjects() path matches.
  writeFileSync(
    join(claudeHome, '..', '.claude.json'),
    JSON.stringify({ projects }, null, 2),
    'utf8',
  )
}

describe('scanHistoryFile (ant xd8)', () => {
  test('count mode returns 0 when file is missing', async () => {
    expect(
      await scanHistoryFile(
        join(claudeHome, 'nothing.jsonl'),
        new Set(['/p1']),
        'count',
      ),
    ).toBe(0)
  })

  test('count mode skips malformed lines and unrelated projects', async () => {
    const histPath = join(claudeHome, 'history.jsonl')
    writeFileSync(
      histPath,
      [
        '{"project":"/p1","prompt":"hi"}',
        'definitely not json',
        '{"project":"/other","prompt":"x"}',
        '{"project":"/p1/sub","prompt":"y"}',
        '{"noproject":true}',
      ].join('\n') + '\n',
      'utf8',
    )
    expect(
      await scanHistoryFile(histPath, new Set(['/p1']), 'count'),
    ).toBe(2)
  })

  test('filter mode rewrites file keeping only non-matching lines', async () => {
    const histPath = join(claudeHome, 'history.jsonl')
    writeFileSync(
      histPath,
      [
        '{"project":"/p1","prompt":"hi"}',
        '{"project":"/other","prompt":"x"}',
        '{"project":"/p1/sub","prompt":"y"}',
      ].join('\n') + '\n',
      'utf8',
    )
    const matched = await scanHistoryFile(
      histPath,
      new Set(['/p1']),
      'filter',
    )
    expect(matched).toBe(2)
    const remaining = readFileSync(histPath, 'utf8')
    expect(remaining).toContain('"/other"')
    expect(remaining).not.toContain('"/p1"')
  })

  test('filter mode produces empty file when ALL lines match', async () => {
    const histPath = join(claudeHome, 'history.jsonl')
    writeFileSync(
      histPath,
      [
        '{"project":"/p1","prompt":"hi"}',
        '{"project":"/p1","prompt":"hi2"}',
      ].join('\n') + '\n',
      'utf8',
    )
    const matched = await scanHistoryFile(
      histPath,
      new Set(['/p1']),
      'filter',
    )
    expect(matched).toBe(2)
    expect(readFileSync(histPath, 'utf8')).toBe('')
  })

  test('filter does NOT rewrite when nothing matches (preserves file)', async () => {
    const histPath = join(claudeHome, 'history.jsonl')
    const original = '{"project":"/zzz","prompt":"hi"}\n'
    writeFileSync(histPath, original, 'utf8')
    const matched = await scanHistoryFile(
      histPath,
      new Set(['/p1']),
      'filter',
    )
    expect(matched).toBe(0)
    // ant xd8 only writes if matchCount > 0 — pin that we don't touch
    // an unrelated history.jsonl.
    expect(readFileSync(histPath, 'utf8')).toBe(original)
  })

  test('path-prefix matching uses sep boundary (no /foo matching /foobar)', async () => {
    const histPath = join(claudeHome, 'history.jsonl')
    writeFileSync(
      histPath,
      [
        '{"project":"/foo","prompt":"a"}',
        '{"project":"/foobar","prompt":"b"}',
        '{"project":"/foo/sub","prompt":"c"}',
      ].join('\n') + '\n',
      'utf8',
    )
    expect(
      await scanHistoryFile(histPath, new Set(['/foo']), 'count'),
    ).toBe(2) // /foo and /foo/sub, NOT /foobar
  })
})

describe('collectProjectPurgeItems (ant ci3)', () => {
  test('returns empty plan for non-existent project (no slug dir, no config)', async () => {
    const plan = await collectProjectPurgeItems('/tmp/nonexistent-project')
    expect(plan.items).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  test('collects project dir + config-key when both present', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'ccb-proj-'))
    try {
      const slug = proj.replace(/[^a-zA-Z0-9]/g, '-')
      const slugDir = join(claudeHome, 'projects', slug)
      mkdirSync(slugDir, { recursive: true })
      // Empty session JSONL (UUID-shaped) so listSessionIdsInProjectDir picks it up.
      writeFileSync(
        join(slugDir, '00000000-0000-0000-0000-000000000001.jsonl'),
        '',
        'utf8',
      )
      setupClaudeJson({ [proj]: { trust: true } })

      const plan = await collectProjectPurgeItems(proj)
      const kinds = plan.items.map(i => i.kind).sort()
      // Project dir + config-key — tasks/debug/file-history not created.
      expect(kinds).toContain('dir')
      expect(kinds).toContain('config-key')

      const projectDir = plan.items.find(
        i => i.kind === 'dir' && i.reason.startsWith('project transcripts'),
      )
      expect(projectDir?.path).toBe(slugDir)

      const configKey = plan.items.find(i => i.kind === 'config-key')
      expect(configKey?.path).toBe(proj)
    } finally {
      rmSync(proj, { recursive: true, force: true })
    }
  })

  test('collects per-session tasks/debug/file-history dirs', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'ccb-proj-'))
    try {
      const slug = proj.replace(/[^a-zA-Z0-9]/g, '-')
      const slugDir = join(claudeHome, 'projects', slug)
      mkdirSync(slugDir, { recursive: true })
      const sid = '12345678-1234-1234-1234-123456789012'
      writeFileSync(join(slugDir, `${sid}.jsonl`), '', 'utf8')

      // Per-session disk artefacts.
      const tasksDir = join(claudeHome, 'tasks', sid)
      mkdirSync(tasksDir, { recursive: true })
      writeFileSync(join(tasksDir, 'task.json'), '{}', 'utf8')

      const debugFile = join(claudeHome, 'debug', `${sid}.txt`)
      mkdirSync(join(claudeHome, 'debug'), { recursive: true })
      writeFileSync(debugFile, 'log', 'utf8')

      const fileHistory = join(claudeHome, 'file-history', sid)
      mkdirSync(fileHistory, { recursive: true })

      const plan = await collectProjectPurgeItems(proj)
      const paths = plan.items.map(i => i.path)
      expect(paths).toContain(tasksDir)
      expect(paths).toContain(debugFile)
      expect(paths).toContain(fileHistory)
    } finally {
      rmSync(proj, { recursive: true, force: true })
    }
  })

  test('non-UUID-shaped jsonl filenames are ignored for session-id sweep', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'ccb-proj-'))
    try {
      const slug = proj.replace(/[^a-zA-Z0-9]/g, '-')
      const slugDir = join(claudeHome, 'projects', slug)
      mkdirSync(slugDir, { recursive: true })
      writeFileSync(join(slugDir, 'not-a-uuid.jsonl'), '', 'utf8')

      // Plant fake tasks/<not-a-uuid> — must NOT be collected because
      // we never recognise 'not-a-uuid' as a session id.
      const fakeTasks = join(claudeHome, 'tasks', 'not-a-uuid')
      mkdirSync(fakeTasks, { recursive: true })

      const plan = await collectProjectPurgeItems(proj)
      const paths = plan.items.map(i => i.path)
      expect(paths).not.toContain(fakeTasks)
    } finally {
      rmSync(proj, { recursive: true, force: true })
    }
  })

  test('history.jsonl item carries matchPaths matching project roots', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'ccb-proj-'))
    try {
      const historyPath = join(claudeHome, 'history.jsonl')
      writeFileSync(
        historyPath,
        `${JSON.stringify({ project: proj, prompt: 'hi' })}\n`,
        'utf8',
      )
      const plan = await collectProjectPurgeItems(proj)
      const hist = plan.items.find(i => i.kind === 'history-lines')
      expect(hist).toBeTruthy()
      expect(hist?.matchPaths).toBeDefined()
      expect(hist!.matchPaths!.has(proj)).toBe(true)
      expect(hist?.reason).toContain('1 prompt')
    } finally {
      rmSync(proj, { recursive: true, force: true })
    }
  })

  test('warnings surface shell-snapshots/ and backups/', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'ccb-proj-'))
    try {
      mkdirSync(join(claudeHome, 'shell-snapshots'), { recursive: true })
      mkdirSync(join(claudeHome, 'backups'), { recursive: true })
      const plan = await collectProjectPurgeItems(proj)
      expect(plan.warnings.join('|')).toContain('shell-snapshots')
      expect(plan.warnings.join('|')).toContain('backups')
    } finally {
      rmSync(proj, { recursive: true, force: true })
    }
  })
})

describe('collectAllProjectsPurgeItems (ant li3)', () => {
  test('collects every top-level dir + history.jsonl + config keys', async () => {
    for (const name of ['projects', 'tasks', 'debug', 'file-history']) {
      mkdirSync(join(claudeHome, name), { recursive: true })
    }
    writeFileSync(join(claudeHome, 'history.jsonl'), '{}\n', 'utf8')
    setupClaudeJson({ '/a': {}, '/b': {} })

    const plan = await collectAllProjectsPurgeItems()
    const kinds = plan.items.map(i => i.kind)
    expect(kinds.filter(k => k === 'dir').length).toBe(4) // 4 top-level dirs
    expect(kinds.filter(k => k === 'file').length).toBe(1) // history.jsonl
    expect(kinds.filter(k => k === 'config-key').length).toBe(2) // /a + /b
  })

  test('skips dirs that don\u2019t exist', async () => {
    setupClaudeJson({})
    const plan = await collectAllProjectsPurgeItems()
    // No dirs were created — items is empty (no projects map either).
    expect(plan.items).toEqual([])
  })
})

describe('executePurgeItem (ant Id8)', () => {
  test('dir kind removes recursively', async () => {
    const dir = join(claudeHome, 'to-remove')
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'sub', 'a.txt'), '', 'utf8')
    await executePurgeItem({ path: dir, kind: 'dir', reason: '' })
    expect(existsSync(dir)).toBe(false)
  })

  test('file kind removes single file', async () => {
    const file = join(claudeHome, 'kill.txt')
    writeFileSync(file, 'x', 'utf8')
    await executePurgeItem({ path: file, kind: 'file', reason: '' })
    expect(existsSync(file)).toBe(false)
  })

  test('config-key removes only the specified key', async () => {
    setupClaudeJson({ '/a': { trust: true }, '/b': { trust: false } })
    await executePurgeItem({
      path: '/a',
      kind: 'config-key',
      reason: '',
    })
    const after = JSON.parse(
      readFileSync(join(claudeHome, '..', '.claude.json'), 'utf8'),
    ) as { projects: Record<string, unknown> }
    expect('/a' in after.projects).toBe(false)
    expect('/b' in after.projects).toBe(true)
  })

  test('history-lines filters using matchPaths', async () => {
    const histPath = join(claudeHome, 'history.jsonl')
    writeFileSync(
      histPath,
      [
        '{"project":"/p1","prompt":"hi"}',
        '{"project":"/other","prompt":"x"}',
      ].join('\n') + '\n',
      'utf8',
    )
    await executePurgeItem({
      path: histPath,
      kind: 'history-lines',
      reason: '',
      matchPaths: new Set(['/p1']),
    })
    const remaining = readFileSync(histPath, 'utf8')
    expect(remaining).toContain('/other')
    expect(remaining).not.toContain('/p1')
  })
})
