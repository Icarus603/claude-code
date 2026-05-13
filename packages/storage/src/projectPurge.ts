/**
 * `project purge` core — byte-for-byte port of ant v2.1.136
 *   - `ci3` → collectProjectPurgeItems (single-project plan)
 *   - `li3` → collectAllProjectsPurgeItems (--all plan)
 *   - `Id8` → executePurgeItem (kind dispatch)
 *   - `xd8` → scanHistoryFile (count / filter modes for ~/.claude/history.jsonl)
 *   - `Qi3` → projectDirOwnedByPaths (slug-prefix-match + JSONL `cwd` probe)
 *   - `gi3` → historyLineMatchesProjects
 *   - `bnK` → pathBelongsToProjects (path === root || startsWith(root + sep))
 *   - `di3` → listSessionIdsInProjectDir (.jsonl filenames, UUID-shaped only)
 *
 * The implementation is pure of CLI / stdout / process.exit — the CLI
 * handler in packages/cli/src/commands/project-commands.ts owns the
 * print / prompt / confirm flow (ant `ni3`, `SnK`, `xnK`, `CnK`, `EnK`).
 *
 * Items collected per project (ant `ci3`):
 *   - per-session tasks dir:    ~/.claude/tasks/<sessionId>/
 *   - per-session debug log:    ~/.claude/debug/<sessionId>.txt
 *   - per-session file-history: ~/.claude/file-history/<sessionId>/
 *   - project dir:              ~/.claude/projects/<slug>/ (transcripts + memory/)
 *   - config-key entries:       ~/.claude.json[projects][<projectPath>] (and
 *                               canonicalized variant)
 *   - history.jsonl lines:      ~/.claude/history.jsonl lines whose `cwd`
 *                               belongs to one of the project paths
 *
 * Warnings (`ci3` last block):
 *   - shell-snapshots/ are not project-scoped
 *   - backups/ may still contain entries in old snapshots
 */
import { createReadStream } from 'fs'
import { readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { createInterface } from 'readline'
import { join, resolve as pathResolve, sep as pathSep } from 'path'
import { getClaudeConfigHomeDir } from '@claude-code/config/env/utils'
import {
  canonicalizePath,
  getProjectsDir,
  sanitizePath,
} from './sessionStoragePortable.js'
import { getWorktreePathsPortable } from './getWorktreePathsPortable.js'
import { findGitRoot } from './findGitRoot.js'

/**
 * Mirror of `agent/tasks.ts` `getTasksDir` + `sanitizePathComponent`. We
 * can't import them from `@claude-code/agent/tasks` because agent already
 * imports from storage — that direction is the canonical one, so the
 * cycle prevention rule forbids the reverse. The contract is a 3-line
 * regex replace; duplicating it costs less than adding a fourth package.
 */
function sanitizePathComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function getTasksDir(taskListId: string): string {
  return join(
    getClaudeConfigHomeDir(),
    'tasks',
    sanitizePathComponent(taskListId),
  )
}

/** ant `Ui3` — UUID regex shape used for session id detection in filenames. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ant `bnK` — used inside Qi3 to bail early when only a handful of lines need scanning. */
const MAX_JSONL_PROBE_LINES = 50

export type PurgeItemKind = 'dir' | 'file' | 'config-key' | 'history-lines'

export type PurgeItem = {
  kind: PurgeItemKind
  path: string
  reason: string
  /**
   * Only set on `history-lines` items — the set of project root paths a
   * history entry's `cwd` must belong to in order to be REMOVED. Mirrors
   * ant's `matchPaths` field on the history-lines record.
   */
  matchPaths?: ReadonlySet<string>
  /** Best-effort size estimate for `dir`/`file` items. 0 / undefined elsewhere. */
  size?: number
}

export type PurgePlan = {
  items: PurgeItem[]
  warnings: string[]
}

/**
 * Ant `xd8` — scan `~/.claude/history.jsonl`, either counting matches
 * (mode='count') or REWRITING the file in-place to KEEP only non-matching
 * lines (mode='filter'). A line "matches" iff its parsed JSON has a
 * `project` field whose path is path-equal-to or path-prefix-of any
 * project root in `matchPaths`. Best-effort: malformed lines are dropped
 * in 'filter' mode (so we don't keep garbage), and ENOENT returns 0.
 */
export async function scanHistoryFile(
  filePath: string,
  matchPaths: ReadonlySet<string>,
  mode: 'count' | 'filter',
): Promise<number> {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const kept: string[] = []
  let matchCount = 0
  try {
    for await (const line of rl) {
      if (historyLineMatchesProjects(line, matchPaths)) {
        matchCount++
      } else if (mode === 'filter') {
        kept.push(line)
      }
    }
  } catch (err) {
    if (isEnoent(err)) return 0
    throw err
  } finally {
    rl.close()
    stream.close()
  }
  if (mode === 'filter' && matchCount > 0) {
    await writeFile(
      filePath,
      kept.length > 0 ? `${kept.join('\n')}\n` : '',
      'utf-8',
    )
  }
  return matchCount
}

/** Ant `gi3` — does this raw JSONL line belong to one of the project roots? */
function historyLineMatchesProjects(
  line: string,
  matchPaths: ReadonlySet<string>,
): boolean {
  if (!line) return false
  try {
    const parsed = JSON.parse(line) as { project?: unknown }
    if (typeof parsed.project !== 'string') return false
    return pathBelongsToProjects(parsed.project, matchPaths)
  } catch {
    return false
  }
}

/**
 * Ant `bnK` — path is owned by one of the root paths iff
 *   path === root  OR  path.startsWith(root + sep)
 * Trailing separator avoids `/foo/bar` matching `/foo/ba`.
 */
function pathBelongsToProjects(
  path: string,
  matchPaths: ReadonlySet<string>,
): boolean {
  for (const root of matchPaths) {
    if (path === root || path.startsWith(root + pathSep)) return true
  }
  return false
}

/**
 * Ant `di3` — list every UUID-shaped session id (filename minus .jsonl)
 * found in a project directory. Returns [] on read error.
 */
async function listSessionIdsInProjectDir(
  projectDir: string,
): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(projectDir)
  } catch {
    return []
  }
  return entries
    .filter(name => name.endsWith('.jsonl'))
    .map(name => name.slice(0, -'.jsonl'.length))
    .filter(name => UUID_REGEX.test(name))
}

/**
 * Ant `Qi3` — given a slug-prefix candidate project dir and the set of
 * project roots we're purging, probe up to N JSONL files (sorted) and
 * up to N lines per file to confirm a single entry has a `cwd` that
 * belongs to one of the roots. Used to claim slug-prefix-matched dirs
 * whose hash suffix differs from the exact slug (long-path collisions
 * between Bun/Node hash, plus pre-canonicalised installs).
 */
async function projectDirOwnedByPaths(
  candidateDir: string,
  matchPaths: ReadonlySet<string>,
): Promise<boolean> {
  let entries: string[]
  try {
    entries = (await readdir(candidateDir))
      .filter(name => name.endsWith('.jsonl'))
      .sort()
  } catch {
    return false
  }
  for (const name of entries) {
    const filePath = join(candidateDir, name)
    const stream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let lineCount = 0
    try {
      for await (const line of rl) {
        if (++lineCount > MAX_JSONL_PROBE_LINES) break
        try {
          const parsed = JSON.parse(line) as { cwd?: unknown }
          if (
            typeof parsed.cwd === 'string' &&
            pathBelongsToProjects(parsed.cwd, matchPaths)
          ) {
            return true
          }
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // best-effort — fall through and try next file
    } finally {
      rl.close()
      stream.close()
    }
  }
  return false
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function isEnoent(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT',
  )
}

function normalizeKey(path: string): string {
  // ant uses `wr(W).replace(/\/+$/,"")||"/"` to normalise project keys
  // for the .claude.json projects map. The leading slash + trailing slash
  // strip ensures `/foo/` and `/foo` collapse to the same key.
  return path.normalize('NFC').replace(/\/+$/, '') || '/'
}

async function readClaudeJsonProjects(): Promise<{
  filePath: string
  projects: Record<string, unknown>
} | null> {
  const claudeJsonPath = join(
    getClaudeConfigHomeDir(),
    '..',
    '.claude.json',
  )
  try {
    const raw = await readFile(claudeJsonPath, 'utf-8')
    const cfg = JSON.parse(raw) as { projects?: Record<string, unknown> }
    return { filePath: claudeJsonPath, projects: cfg.projects ?? {} }
  } catch {
    return null
  }
}

/**
 * Ant `ci3` — build the per-project purge plan. Pure: returns the list
 * of items that WOULD be deleted, not a side-effect.
 */
export async function collectProjectPurgeItems(
  projectPath: string,
): Promise<PurgePlan> {
  const home = getClaudeConfigHomeDir()
  const rawRoot = pathResolve(projectPath)
  const canonicalRoot = await canonicalizePath(rawRoot)
  const projectRoots: ReadonlySet<string> = new Set([rawRoot, canonicalRoot])

  // Also resolve the git repo root for each project root — ant `M$(W)`
  // returns the enclosing repo root (if any), so worktrees under that
  // repo get included in the slug-prefix scan. Skip if any root path
  // doesn't exist (stat throws).
  const repoRoots: string[] = []
  let anyRootExists = false
  for (const root of projectRoots) {
    if (await exists(root)) {
      anyRootExists = true
      const repo = findGitRoot(root)
      if (repo) repoRoots.push(repo)
    }
  }

  // 1. Direct slug match for each project root.
  const projectDirs = new Set<string>()
  for (const root of projectRoots) {
    const slug = sanitizePath(root)
    const dir = join(getProjectsDir(), slug)
    if (await exists(dir)) projectDirs.add(dir)
  }

  // 2. Sibling git-worktree slugs — ant `l0(W)` returns worktree paths
  //    for each project root and adds their resolved project dirs.
  for (const root of projectRoots) {
    let worktreePaths: string[] = []
    try {
      worktreePaths = await getWorktreePathsPortable(root)
    } catch {
      worktreePaths = []
    }
    for (const wt of worktreePaths) {
      const slug = sanitizePath(wt)
      const dir = join(getProjectsDir(), slug)
      if (await exists(dir)) projectDirs.add(dir)
    }
  }

  // 3. Slug-prefix scan — ant walks `WL()` (projects dir) and finds any
  //    sibling dir starting with `<slug>-` whose first .jsonl has a `cwd`
  //    that belongs to one of our project roots. This catches long-path
  //    hash-suffix collisions AND pre-canonicalised dirs that weren't
  //    listed under exact slug.
  const slugPrefixes = [...projectRoots].map(r => sanitizePath(r) + '-')
  try {
    const entries = await readdir(getProjectsDir(), { withFileTypes: true })
    for (const e of entries) {
      const full = join(getProjectsDir(), e.name)
      if (!e.isDirectory()) continue
      if (projectDirs.has(full)) continue
      if (!slugPrefixes.some(p => e.name.startsWith(p))) continue
      if (await projectDirOwnedByPaths(full, projectRoots)) {
        projectDirs.add(full)
      }
    }
  } catch {
    // projects dir absent — nothing to scan
  }

  // 4. Collect every session id present across the discovered project dirs.
  const sessionIds = new Set<string>()
  for (const dir of projectDirs) {
    for (const id of await listSessionIdsInProjectDir(dir)) {
      sessionIds.add(id)
    }
  }

  // 5. Per-session purge items: tasks/<id>, debug/<id>.txt, file-history/<id>.
  const items: PurgeItem[] = []
  for (const sessionId of sessionIds) {
    const tasksDir = getTasksDir(sessionId)
    if (await exists(tasksDir)) {
      items.push({
        path: tasksDir,
        kind: 'dir',
        reason: `tasks for session ${sessionId}`,
      })
    }
    const debugFile = join(home, 'debug', `${sessionId}.txt`)
    if (await exists(debugFile)) {
      items.push({
        path: debugFile,
        kind: 'file',
        reason: `debug log for session ${sessionId}`,
      })
    }
    const fileHistoryDir = join(home, 'file-history', sessionId)
    if (await exists(fileHistoryDir)) {
      items.push({
        path: fileHistoryDir,
        kind: 'dir',
        reason: `file edit history for session ${sessionId}`,
      })
    }
  }

  // 6. The project dirs themselves.
  for (const dir of projectDirs) {
    items.push({
      path: dir,
      kind: 'dir',
      reason: 'project transcripts (.jsonl) and memory/',
    })
  }

  // 7. Config-key entries in ~/.claude.json. Match each `projects` key
  //    whose normalised form equals one of our roots OR a repo root.
  const cfg = await readClaudeJsonProjects()
  if (cfg) {
    const keys = new Set<string>(
      [...projectRoots, ...repoRoots].map(normalizeKey),
    )
    for (const key of Object.keys(cfg.projects)) {
      if (keys.has(normalizeKey(key))) {
        items.push({
          path: key,
          kind: 'config-key',
          reason:
            'project entry in ~/.claude.json (trust, history, MCP servers)',
        })
      }
    }
  }

  // 8. history.jsonl — count matching lines (delete pass uses scanHistoryFile filter mode).
  const historyJsonl = join(home, 'history.jsonl')
  if (await exists(historyJsonl)) {
    const count = await scanHistoryFile(historyJsonl, projectRoots, 'count')
    if (count > 0) {
      items.push({
        path: historyJsonl,
        kind: 'history-lines',
        reason: `${count} prompt(s) typed in this project`,
        matchPaths: projectRoots,
      })
    }
  }

  // 9. Warnings — surfaced to the user but not actionable here.
  const warnings: string[] = []
  if (await exists(join(home, 'shell-snapshots'))) {
    warnings.push(
      'shell-snapshots/ are not project-scoped and will not be touched',
    )
  }
  const backupsDir = join(home, 'backups')
  if (await exists(backupsDir)) {
    warnings.push(
      `backups/ may still contain this project entry in old .claude.json snapshots (${backupsDir}); at most 5 are kept and they rotate out automatically`,
    )
  }

  // If nothing on disk for this project AT ALL (none of the roots existed
  // AND nothing got collected), ant still returns an empty plan and lets
  // the caller decide what to say. Match that — no special-casing here.
  void anyRootExists
  return { items, warnings }
}

/**
 * Ant `li3` — `--all` purge plan. Collects every top-level dir that
 * holds project state, plus history.jsonl, plus every config-key in
 * `~/.claude.json#projects`. No worktree / slug-prefix scan needed.
 */
export async function collectAllProjectsPurgeItems(): Promise<PurgePlan> {
  const home = getClaudeConfigHomeDir()
  const items: PurgeItem[] = []
  const warnings: string[] = []

  const topDirs: ReadonlyArray<readonly [string, string]> = [
    ['projects', 'all project transcripts (.jsonl) and memory/'],
    ['tasks', 'all session task lists'],
    ['debug', 'all session debug logs'],
    ['file-history', 'all session file edit history'],
  ]
  for (const [name, reason] of topDirs) {
    const dir = join(home, name)
    if (await exists(dir)) {
      items.push({ path: dir, kind: 'dir', reason })
    }
  }

  const historyJsonl = join(home, 'history.jsonl')
  if (await exists(historyJsonl)) {
    items.push({
      path: historyJsonl,
      kind: 'file',
      reason: 'prompt history across all projects',
    })
  }

  const cfg = await readClaudeJsonProjects()
  if (cfg) {
    for (const key of Object.keys(cfg.projects)) {
      items.push({
        path: key,
        kind: 'config-key',
        reason:
          'project entry in ~/.claude.json (trust, history, MCP servers)',
      })
    }
  }

  if (await exists(join(home, 'shell-snapshots'))) {
    warnings.push(
      'shell-snapshots/ are not project-scoped and will not be touched',
    )
  }
  const backupsDir = join(home, 'backups')
  if (await exists(backupsDir)) {
    warnings.push(
      `backups/ may still contain project entries in old .claude.json snapshots (${backupsDir}); at most 5 are kept and they rotate out automatically`,
    )
  }
  return { items, warnings }
}

/**
 * Ant `Id8` — execute a single plan item by kind dispatch. Side-effects
 * only; returns nothing. Caller wraps in try/catch and aggregates.
 */
export async function executePurgeItem(item: PurgeItem): Promise<void> {
  switch (item.kind) {
    case 'config-key':
      await deleteClaudeJsonProjectKey(item.path)
      return
    case 'history-lines': {
      const home = getClaudeConfigHomeDir()
      const historyJsonl = join(home, 'history.jsonl')
      await scanHistoryFile(
        item.path === historyJsonl ? item.path : historyJsonl,
        item.matchPaths ?? new Set(),
        'filter',
      )
      return
    }
    case 'file':
    case 'dir':
      await rm(item.path, { recursive: item.kind === 'dir', force: true })
      return
  }
}

async function deleteClaudeJsonProjectKey(projectKey: string): Promise<void> {
  const claudeJsonPath = join(
    getClaudeConfigHomeDir(),
    '..',
    '.claude.json',
  )
  let raw: string
  try {
    raw = await readFile(claudeJsonPath, 'utf-8')
  } catch {
    return
  }
  let cfg: { projects?: Record<string, unknown> }
  try {
    cfg = JSON.parse(raw)
  } catch {
    return
  }
  if (!cfg.projects || !(projectKey in cfg.projects)) return
  delete cfg.projects[projectKey]
  await writeFile(claudeJsonPath, JSON.stringify(cfg, null, 2), 'utf-8')
}

// ----------------------------------------------------------------------------
// Back-compat thin wrappers — preserve the old API so existing CLI / tests
// keep compiling while we migrate the handler to the new ant-shaped API.
// ----------------------------------------------------------------------------

/** @deprecated Use `collectProjectPurgeItems` (returns PurgePlan). */
export async function collectPurgeItems(
  projectPath: string,
): Promise<PurgeItem[]> {
  const { items } = await collectProjectPurgeItems(projectPath)
  return items
}

/** @deprecated Use `executePurgeItem` per-item — handler aggregates counts. */
export async function executePurgeItems(
  items: ReadonlyArray<PurgeItem>,
  _opts: { projectPath: string } = { projectPath: '' },
): Promise<{ removed: number; bytes: number }> {
  let removed = 0
  for (const item of items) {
    try {
      await executePurgeItem(item)
      removed++
    } catch {
      // best-effort per ant
    }
  }
  return { removed, bytes: 0 }
}
