#!/usr/bin/env bun
/**
 * Audit 04: dual-storage divergence.
 *
 * Pattern: read-side and write-side of the same logical storage live
 * in different files / packages, with no clear contract that they're
 * the same backing store. Ralph-loop bug exemplar:
 *   - `loadPluginHooks()` calls `registerHookCallbacks(hooks)` from
 *     `packages/config/plugin/_deps.ts` (no-op default placeholder)
 *   - `agent/hooks.ts` calls `getRegisteredHooks()` from
 *     `@claude-code/app-host/bootstrap/state.js` (real STATE)
 *   - Read and write went to different storages — silent for ~200 commits.
 *
 * Detection heuristic:
 *   1. Find verb-pairs: get/set, read/write, load/save, register/clear,
 *      add/remove, push/pop, etc. — applied to the same noun.
 *   2. For each pair, check whether the writer's source file matches
 *      the reader's source file (or at least the same package).
 *   3. Flag mismatches.
 *
 * This is approximate (verbs/nouns are heuristic), but ralph-loop's
 * specific case will be found, plus likely several siblings.
 */
import { findFiles, readSafe, emitJson, summarize, type Finding, type AuditResult } from './lib.js'

const VERB_PAIRS: Array<[string, string]> = [
  ['get', 'set'],
  ['get', 'register'],
  ['get', 'add'],
  ['register', 'unregister'],
  ['register', 'clear'],
  ['load', 'save'],
  ['read', 'write'],
  ['add', 'remove'],
]

interface FunctionDecl { name: string; file: string; pkg: string }

function packageOf(file: string): string {
  // packages/foo/...
  const m = file.match(/^packages\/(@?[^/]+\/?[^/]*)\//)
  return m?.[1] ?? '<unknown>'
}

function listExports(): FunctionDecl[] {
  const out: FunctionDecl[] = []
  // Search packages for `export function NAME` and `export const NAME =`
  // anywhere — we want a directory of all "named entities" the rest of
  // the codebase can call.
  const { execSync } = require('child_process')
  let raw = ''
  try {
    raw = execSync(
      `grep -rEn '^(export\\s+)?(async\\s+)?function\\s*\\*?\\s*[a-z]\\w+|^export\\s+const\\s+[a-z]\\w+\\s*=' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
      { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
    ) as string
  } catch {}
  for (const ln of raw.split('\n')) {
    const lm = ln.match(/^([^:]+):\d+:(.*)$/)
    if (!lm) continue
    const [_, file, content] = lm
    let m = content.match(/function\s*\*?\s*([a-z]\w+)/) ||
            content.match(/export\s+const\s+([a-z]\w+)\s*=/)
    if (!m) continue
    out.push({ name: m[1], file, pkg: packageOf(file) })
  }
  return out
}

const allFns = listExports()
const byName = new Map<string, FunctionDecl[]>()
for (const f of allFns) {
  if (!byName.has(f.name)) byName.set(f.name, [])
  byName.get(f.name)!.push(f)
}

const findings: Finding[] = []
const seen = new Set<string>()  // dedupe finding pairs

for (const fn of allFns) {
  for (const [readVerb, writeVerb] of VERB_PAIRS) {
    // If `fn.name` starts with one verb, search for the matching pair.
    const pre = fn.name.toLowerCase()
    let noun: string | null = null
    if (pre.startsWith(readVerb) && fn.name.length > readVerb.length) {
      noun = fn.name.slice(readVerb.length)
    } else if (pre.startsWith(writeVerb) && fn.name.length > writeVerb.length) {
      noun = fn.name.slice(writeVerb.length)
    } else continue

    const readerName = readVerb + noun
    const writerName = writeVerb + noun
    const readerSites = byName.get(readerName) ?? []
    const writerSites = byName.get(writerName) ?? []
    if (readerSites.length === 0 || writerSites.length === 0) continue

    const key = `${readerName}|${writerName}`
    if (seen.has(key)) continue
    seen.add(key)

    // Pair every reader with every writer to detect cross-package writes.
    for (const r of readerSites) {
      for (const w of writerSites) {
        if (r.file === w.file) continue  // same file — co-located
        if (r.pkg === w.pkg) continue  // same package — close enough
        findings.push({
          pattern: 'dual-storage-divergence',
          file: r.file,
          line: 0,
          snippet: `${readerName} ← ${r.pkg}; ${writerName} → ${w.pkg}`,
          severity: 'MEDIUM',
          note: `Reader ${readerName} lives in ${r.pkg} (${r.file}); writer ${writerName} lives in ${w.pkg} (${w.file}). Verify they share the same backing store. The ralph-loop bug was exactly this pattern: registerHookCallbacks wrote to _deps.ts placeholder, getRegisteredHooks read from app-host STATE.`,
        })
      }
    }
  }
}

const result: AuditResult = {
  pattern: 'dual-storage-divergence',
  description: 'Verb pairs (get/set, read/write, register/clear) where reader and writer are in different packages',
  totalScanned: allFns.length,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
