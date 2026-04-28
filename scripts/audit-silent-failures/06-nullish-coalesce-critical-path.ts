#!/usr/bin/env bun
/**
 * Audit 06: ?? null/[]/{}/0 in critical paths.
 *
 * Pattern: `something() ?? []` where `something()` returning null is
 * NOT just an absence (success case) but a real failure that the
 * caller silently masks.
 *
 * Heuristic: lines containing `?? []` / `?? {}` / `?? null` / `?? 0` /
 * `?? false` / `?? ''` in files that look like critical-path code:
 * - packages/agent/{hooks,query,createDeps,attachments,messages}.ts
 * - packages/agent/internal/*
 * - packages/permission/*
 * - packages/provider/*
 * - packages/config/plugin/*
 * - packages/repl/src/screens/*
 *
 * In other files, ?? is usually just a default; flag-only-when-critical
 * keeps signal-to-noise high.
 */
import { emitJson, summarize, type Finding, type AuditResult } from './lib.js'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

const fileLineCache = new Map<string, string[]>()
function fileLines(file: string): string[] {
  if (!fileLineCache.has(file)) {
    try {
      fileLineCache.set(file, readFileSync(file, 'utf8').split('\n'))
    } catch {
      fileLineCache.set(file, [])
    }
  }
  return fileLineCache.get(file)!
}

const CRITICAL_PATTERNS = [
  /^packages\/agent\/(hooks|query|createDeps|attachments|messages)\.ts$/,
  /^packages\/agent\/internal\//,
  /^packages\/agent\/host\.ts$/,
  /^packages\/agent\/agentHostBindings\.ts$/,
  /^packages\/permission\/.*\.ts$/,
  /^packages\/provider\/.*\.ts$/,
  /^packages\/config\/plugin\/.*\.ts$/,
  /^packages\/app-host\/.*\.ts$/,
  /^packages\/repl\/src\/screens\/.*\.tsx?$/,
]

let raw = ''
try {
  raw = execSync(
    `grep -rEn '\\?\\?\\s*(\\[\\]|\\{\\}|null|undefined|0|false|"")' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=__tests__`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
  )
} catch {}

const findings: Finding[] = []
let total = 0
for (const ln of raw.split('\n')) {
  const m = ln.match(/^([^:]+):(\d+):(.*)$/)
  if (!m) continue
  total++
  const [_, file, lineStr, content] = m
  if (!CRITICAL_PATTERNS.some(re => re.test(file))) continue
  // Skip comment lines
  if (/^\s*(\/\/|\*|\/\*)/.test(content)) continue
  // Skip patterns that are clearly safe defaults (string concat, length etc.)
  if (/length\s*\?\?/.test(content)) continue

  // Skip idiomatic patterns where ?? is semantically correct, not a bug:
  // - Map/Set/cache lookups: `.get(k) ?? <default>` — null means "not present"
  // - Array/iter access: `.find(...) ?? null`, `[i] ?? null` — null means "not found"
  // - Aggregations: `.reduce(...) ?? 0`, `.length ?? 0` — empty case
  // - Env/config reads: `process.env.X ?? "default"`, `readEnv(...) ?? null`
  // - String parsing: `parseInt(...) ?? 0`, `Number(...) ?? 0`
  // - Optional-chained accesses: `foo?.bar ?? []` is a planned absence
  // Lookup methods that return null/undefined on legitimate absence.
  // Use a balanced-paren matcher (single nesting level) so `.find(p => p.x())` parses.
  if (/\.(get|find|findLast|findIndex|indexOf|at|first|last|head|match|matchAll|exec)\s*\([^()]*(\([^()]*\)[^()]*)*\)\s*\?\?/.test(content)) continue
  if (/\.reduce\s*\([\s\S]*\)\s*\?\?/.test(content)) continue
  if (/\b(parseInt|parseFloat|Number|Math\.\w+)\s*\([^)]*\)\s*\?\?/.test(content)) continue
  if (/process\.env\.\w+\s*\?\?/.test(content)) continue
  if (/readEnv\s*\([^)]*\)\s*\?\?/.test(content)) continue
  // React state selectors: `useAppState(s => s.x.y) ?? default` — selector
  // returns undefined for transient/uninitialized state; default is the
  // intended initial value.
  if (/use(App)?State[A-Z]?\w*\s*\([^)]*=>\s*[^)]+\)\s*\?\?/.test(content)) continue
  // Methods named like `getX/loadX/readX/dumpX`: by convention return null on
  // legitimate absence (config not present, file not found, optional output).
  if (/\b(get|load|read|fetch|find|resolve|select|dump|extract)\w*\s*\([^()]*(\([^()]*\)[^()]*)*\)\s*\?\?/i.test(content)) continue
  // Same idiom but the function call wraps onto preceding lines and the
  // `??` lives on its own line: e.g. `(await dumpFoo(\n  args\n)) ?? null`.
  // We already computed `lhsContext` (defined below); check it for the
  // function-name pattern too. Computed in advance to keep order intact.
  // Optional chain anywhere on the LHS: `obj?.field ?? default`,
  // `obj?.method() ?? default`, `a?.b?.c() ?? default` — all by design.
  // The author already declared the LHS optional; ?? gives the fallback.
  // Walk backward from the FLAGGED `??` on this line (last `??` on the
  // line, since multiple `??` may exist) to find the matching LHS span:
  // either bounded by the previous `??` in the window OR by the start
  // of the slice. If any `?.` lives in that span, the fallback is by
  // design.
  const lineNum = parseInt(lineStr, 10)
  const allLines = fileLines(file)
  const window = allLines.slice(Math.max(0, lineNum - 12), lineNum).join('\n')
  // Strip everything after the LAST `??` on the flagged line; then keep
  // only what's after the SECOND-to-last `??` (so we ignore earlier
  // `??` expressions in the window that pre-empted our split).
  const windowUpToFlagged = window.slice(0, window.lastIndexOf('??'))
  const lastInner = windowUpToFlagged.lastIndexOf('??')
  const lhsContext = lastInner >= 0 ? windowUpToFlagged.slice(lastInner + 2) : windowUpToFlagged
  if (/\?\./.test(lhsContext)) continue
  // Multi-line function-name idiom: same as the line-bound pattern above
  // but the call expression starts on a previous line.
  if (/\b(get|load|read|fetch|find|resolve|select|dump|extract|safe|try|maybe|parse)\w*\s*\(/i.test(lhsContext)) continue
  // Cache/memo defaults (Map.set inc pattern): `(map.get(k) ?? 0) + 1`
  if (/\(\s*\w+\.get\s*\([^)]*\)\s*\?\?/.test(content)) continue
  // Safe-parse / try-parse fallbacks: by-name signal that the function
  // returns null/undefined on parse failure (and the caller wants the default).
  if (/\b(safe|try|maybe|parse)\w*\s*\([^()]*(\([^()]*\)[^()]*)*\)\s*\?\?/i.test(content)) continue
  // Spread defaults inside object construction: `...(thing ?? {})` — common pattern
  if (/\.\.\.\([^)]*\?\?/.test(content)) continue
  // Type-asserted property access: `(x.y as Foo) ?? default` —
  // author's `as` declares the asserted shape; `??` only kicks in if
  // the property was actually undefined. Idiomatic.
  if (/\(\s*[^()]+\s+as\s+\w[\w.<>|&[\] ]*\s*\)\s*\?\?/.test(content)) continue

  // Highlight specifically the kind likely to mask failure: `await fn() ?? []`
  // or `fn() ?? null` where fn() can throw / return null on real error.
  const isCallChain = /\)\s*\?\?\s*(\[\]|\{\}|null|undefined|0|false|"")/.test(content)
  findings.push({
    pattern: 'nullish-coalesce-critical-path',
    file,
    line: parseInt(lineStr, 10),
    snippet: content.trim().slice(0, 140),
    severity: isCallChain ? 'MEDIUM' : 'LOW',
    note: `\`??\` default in critical-path file. If the LHS expression returning null/undefined indicates a real failure (not just absence), this default silently masks it. Verify whether the LHS must be non-null for the caller to function correctly.`,
  })
}

const result: AuditResult = {
  pattern: 'nullish-coalesce-critical-path',
  description: '?? defaults in critical-path files where the LHS may indicate real failure',
  totalScanned: total,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
