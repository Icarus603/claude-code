// Named-workflow registry — port of ant 2.1.150 modules:
//   3889 `_c` (DHK dir loader, MHK user+project merge)
//   3890     (O0_ resolve-by-name, xMH builtin+user/project merge, RM6 cache clear)
//   3888 kb8 (JHK builtin list, sZ register — ant ships ZERO built-ins, jHK is []
//             and sZ is never called; the plugin loader GM6 is a separate path
//             ccb does not have, so it is intentionally omitted here)
//
// A named workflow is a `.js` file under a `workflows/` directory whose body is
// a self-contained workflow script (the same `export const meta = {…}` + body
// the Workflow tool's inline `script` takes). Discovery mirrors skills/commands:
//   - userSettings   → ~/.claude/workflows/*.js          (ant i6()+"/workflows")
//   - projectSettings → <each project root>/.claude/workflows/*.js (ant HJ3)
// Project entries override user entries of the same name (ant MHK Map order).
//
// Exposed to the engine via the NamedWorkflowResolver / AllWorkflowsLister
// contracts (runtime.ts) and to the Workflow tool's resolveScript() for the
// `name` input. node:vm is NOT pulled here — parseWorkflowScript only reads the
// leading `meta` literal — so this stays safe to load off the boot path.

import { join } from 'node:path'
import {
  getAdditionalDirectoriesForClaudeMd,
} from '@claude-code/app-host/bootstrap/state.js'
import { getClaudeConfigHomeDir } from '@claude-code/config/env/utils'
import { isSettingSourceEnabled } from '@claude-code/config/constants'
import { getFsImplementation } from '@claude-code/storage/fsOperations.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { parseWorkflowScript } from './metaParser.js'
import { MAX_WORKFLOW_SCRIPT_BYTES } from './paths.js'

export type NamedWorkflow = {
  source: 'built-in' | 'userSettings' | 'projectSettings'
  name: string
  description: string
  whenToUse?: string
  script: string
  filePath?: string
}

// ant 3888 jHK — built-in registry. ant ships none (sZ is never called); kept
// as the extension point so a future bundled workflow can register here.
const builtinWorkflows: NamedWorkflow[] = []

/** ant 3888 sZ — register a built-in workflow (script + meta). */
export function registerBuiltinWorkflow(
  meta: { name: string; description: string; whenToUse?: string },
  script: string,
): void {
  builtinWorkflows.push({ source: 'built-in', ...meta, script })
}

/** ant 3888 JHK — the built-in list. */
function listBuiltinWorkflows(): NamedWorkflow[] {
  return builtinWorkflows
}

// ant 3889 DHK — read every `.js` workflow file in one directory. Skips
// non-files, non-`.js`, oversized, and meta-invalid files (warn, don't throw).
async function loadWorkflowsFromDir(
  dir: string,
  source: 'userSettings' | 'projectSettings',
): Promise<NamedWorkflow[]> {
  const fs = getFsImplementation()
  let entries
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const loaded = await Promise.all(
    entries.map(async entry => {
      if (!(entry.isFile() || entry.isSymbolicLink())) return null
      if (!entry.name.endsWith('.js')) return null
      const filePath = join(dir, entry.name)
      let script: string
      try {
        script = await fs.readFile(filePath, { encoding: 'utf-8' })
      } catch {
        return null
      }
      if (script.length > MAX_WORKFLOW_SCRIPT_BYTES) {
        logForDebugging(
          `Workflow ${filePath} exceeds ${MAX_WORKFLOW_SCRIPT_BYTES} bytes — skipping`,
        )
        return null
      }
      const parsed = parseWorkflowScript(script)
      if ('error' in parsed) {
        logForDebugging(
          `Workflow ${filePath} has invalid meta: ${parsed.error} — skipping`,
        )
        return null
      }
      return {
        source,
        name: parsed.meta.name,
        description: parsed.meta.description,
        whenToUse: parsed.meta.whenToUse,
        script,
        filePath,
      } satisfies NamedWorkflow
    }),
  )
  return loaded.filter((w): w is NamedWorkflow => w !== null)
}

// ant 3889 MHK — user (~/.claude/workflows) + project (<root>/.claude/workflows)
// directories, gated by isSettingSourceEnabled. Project overrides user by name.
async function loadUserAndProjectWorkflows(): Promise<NamedWorkflow[]> {
  const userDir = join(getClaudeConfigHomeDir(), 'workflows')
  const projectDirs = getAdditionalDirectoriesForClaudeMd().map(root =>
    join(root, '.claude', 'workflows'),
  )
  const [userWorkflows, ...projectWorkflowLists] = await Promise.all([
    isSettingSourceEnabled('userSettings')
      ? loadWorkflowsFromDir(userDir, 'userSettings')
      : Promise.resolve([]),
    ...(isSettingSourceEnabled('projectSettings')
      ? projectDirs.map(dir => loadWorkflowsFromDir(dir, 'projectSettings'))
      : []),
  ])
  // ant MHK: user first, then project entries overwrite same-name keys.
  const byName = new Map<string, NamedWorkflow>()
  for (const w of userWorkflows) byName.set(w.name, w)
  for (const list of projectWorkflowLists) {
    for (const w of list) byName.set(w.name, w)
  }
  return [...byName.values()]
}

let cache: Promise<NamedWorkflow[]> | null = null

// ant 3890 xMH — merge built-in + user/project, de-duplicated by name with
// user/project taking precedence over built-ins. Memoized; clear via
// clearNamedWorkflowsCache (ant RM6/Lb8).
export async function listAllNamedWorkflows(): Promise<NamedWorkflow[]> {
  if (cache) return cache
  cache = (async () => {
    const dirWorkflows = await loadUserAndProjectWorkflows()
    const dirNames = new Set(dirWorkflows.map(w => w.name))
    const builtins = listBuiltinWorkflows().filter(w => !dirNames.has(w.name))
    return [...builtins, ...dirWorkflows]
  })()
  return cache
}

/** ant 3890 RM6/Lb8 — invalidate the merged-workflow cache. */
export function clearNamedWorkflowsCache(): void {
  cache = null
}

// ant 3890 O0_ — resolve a workflow by name from the merged registry.
export async function resolveNamedWorkflow(
  name: string,
): Promise<{ name: string; script: string } | null> {
  const all = await listAllNamedWorkflows()
  const found = all.find(w => w.name === name)
  return found ? { name: found.name, script: found.script } : null
}

/** Names-only lister for the engine's "Available: …" error message. */
export async function listNamedWorkflowNames(): Promise<Array<{ name: string }>> {
  return (await listAllNamedWorkflows()).map(w => ({ name: w.name }))
}
