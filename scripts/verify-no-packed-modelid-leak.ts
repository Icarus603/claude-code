#!/usr/bin/env bun
/**
 * verify-no-packed-modelid-leak — block packed `<connId>:<modelId>` from
 * leaking into user-facing strings.
 *
 * ccb's internal world (AppState.mainLoopModel, model picker, route
 * resolution) keys on the packed `<connId>:<modelId>` form. Any string
 * that surfaces to the user — system prompt, /context UI, /config, error
 * messages — must call `unpackModelId(...).modelId` (or `renderModelSetting`,
 * which already unpacks internally) at the boundary. Leaking the prefix
 * makes Claude refer to itself as `conn_xxx:claude-opus-4-7` in system
 * prompts, breaks the user's mental model of which model they're on, and
 * silently exposes ccb's internal routing scheme.
 *
 * History:
 *   - 69f3c7c8 (2026-04-28) fixed two `/config` leaks (Config.tsx +
 *     modelDisplayString) but did NOT sweep same-class sites.
 *   - The prompts.ts and analyzeContext.ts leaks (this verifier's
 *     motivation) were caught a week later when the user noticed
 *     `The exact model ID is conn_4ohrs652:claude-opus-4-7` in the
 *     system prompt and `conn_xxx:` in /context.
 *
 * The rule (exact-match, not a ratchet — every match is a real bug):
 *
 *   In production code (.ts/.tsx, excluding tests/decompilation noise),
 *   any template literal with `${...model...}` or `${...Model...}` that
 *   emits to a USER-FACING channel must be in a file/region that
 *   demonstrably calls unpackModelId / renderModelSetting / renderModelName
 *   on the value before interpolation, OR the call is in a debug/log/
 *   telemetry channel where the packed form is acceptable for
 *   troubleshooting.
 *
 * Implementation:
 *   1. Walk every .ts/.tsx in packages/.
 *   2. For each `${...}` interpolation whose name matches /\bmodel\b/i
 *      (model, modelId, mainLoopModel, runtimeModel, currentModel,
 *      userSpecifiedModel, …) inside a template literal:
 *      a. Skip if the surrounding line is debug/log/analytics.
 *      b. Skip if the file is annotated `// modelid:ungated reason=…`
 *         within 5 lines above (matches notification-gates allowlist
 *         pattern from verify-notification-gates.ts).
 *      c. Otherwise, require the function/file scope to call
 *         unpackModelId / renderModelSetting / renderModelName / strip the
 *         `<connId>:` prefix in a way the verifier can detect.
 *   3. Anything else is a violation.
 *
 * Escape hatch: prepend the line with `// modelid:bare-by-construction`
 * to vouch that the variable is constructed from a bare wire id (e.g.
 * a model alias from a wizard, or a literal like 'claude-opus-4-7').
 *
 * NOT a ratchet — production violations are bugs. Adding a new template
 * site without going through the boundary is a regression.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')

// Channels where packed form is OK (debug-only, post-process, telemetry).
// Match the entire CALL — these patterns surround the template literal,
// so we look 0–2 lines above the offending line for the call name.
const DEBUG_CHANNEL_RE =
  /\b(?:logForDebugging|logError|logEvent|console\.(?:log|warn|error|debug|info)|debugLog|writeEvent|trackEvent|process\.stderr\.write|process\.stdout\.write\s*\(\s*JSON\.stringify)\b/

// Matches a template-literal interpolation `${expr}` where `expr` mentions
// a model variable. Conservative: focus on the bare identifier patterns
// that historically leak (model, modelId, mainLoopModel, runtimeModel,
// currentModel, userSpecifiedModel, agentModel, parentModel).
//
// Not flagged: `${marketingName}`, `${m.label}`, `${publicName}`, etc. —
// those go through display fns that already unpack.
const MODEL_INTERP_RE = /\$\{[^}]*\b(?:model|modelId|mainLoopModel|runtimeModel|currentModel|userSpecifiedModel|agentModel|parentModel|requestedModel)\b[^}]*\}/g

// Block only template literals (backtick strings). Plain string concat
// (e.g. `'Model: ' + model`) is rare in this codebase and the ratchet
// can be extended later if a new site appears.
const TEMPLATE_STRING_RE = /`[^`]*`/g

// Annotations that vouch for the value being already-unpacked or
// constructed bare. Must be on the same line, the previous line, or up
// to 5 lines above (matches verify-notification-gates pattern).
const VOUCH_RE = /\bmodelid:(?:bare-by-construction|already-unpacked|alias-only|debug-only|ungated)\b/

// Functions that prove "value is already bare" — when one of these is
// called in the same function scope on the offending variable, skip the
// finding. ESLint-style heuristic; not perfectly bulletproof but catches
// the common case.
const UNPACK_FN_RE =
  /\b(?:unpackModelId|renderModelSetting|renderModelName|getPublicModelDisplayName|getMarketingNameForModel|firstPartyNameToCanonical|getCanonicalName|parseUserSpecifiedModel|resolveOverriddenModel|normalizeModelStringForAPI|stripContextSuffix|maskModelCodename|modelDisplayString|renderDefaultModelSetting|renderModelLabel)\b/

// Files / dirs to skip entirely.
const SKIP_DIRS = new Set([
  'node_modules',
  '__tests__',
  'dist',
  'vendor',
  '.git',
])

// Files where packed `${model}` is part of the implementation (the
// connections/model machinery itself). These files own the unpack
// contract — they're allowed to interpolate the raw value because the
// ENTIRE FILE is the unpacker.
const ALLOWLIST_FILES = new Set<string>([
  'packages/provider/src/connections.ts',
  'packages/provider/src/model.ts',
  'packages/provider/src/model/model.ts',
])

function findTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    let s
    try {
      s = statSync(full)
    } catch {
      continue
    }
    if (s.isDirectory()) {
      out.push(...findTsFiles(full))
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      out.push(full)
    }
  }
  return out
}

interface Finding {
  file: string
  line: number
  excerpt: string
}

function scanFile(filePath: string): Finding[] {
  const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/')
  if (ALLOWLIST_FILES.has(rel)) return []

  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  // File-level vouch: any UNPACK_FN_RE call anywhere in the file means
  // the file is aware of the boundary; we skip per-line analysis since
  // grep can't trace dataflow precisely. Files that don't import any
  // unpack helper AND interpolate `${model}` are the real targets.
  if (UNPACK_FN_RE.test(content)) {
    // File knows about unpacking; assume the boundary is observed.
    // (The 4 leaks we just fixed all had no unpack call before fix.)
    return []
  }

  const findings: Finding[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // Skip comments — these won't render to the user.
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue

    // Find every template literal on this line; check each for model interp.
    for (const tmpl of line.matchAll(TEMPLATE_STRING_RE)) {
      const tmplBody = tmpl[0]
      if (!MODEL_INTERP_RE.test(tmplBody)) continue
      // Reset regex state (matchAll doesn't but test does)
      MODEL_INTERP_RE.lastIndex = 0

      // Debug/log/analytics — packed form is acceptable for troubleshoot.
      // Look at the surrounding 2 lines for the channel name (the call
      // often spans lines).
      const surrounding = [
        lines[Math.max(0, i - 2)] ?? '',
        lines[Math.max(0, i - 1)] ?? '',
        line,
      ].join('\n')
      if (DEBUG_CHANNEL_RE.test(surrounding)) continue

      // Per-line vouch annotation in 10-line window above (block comments
      // explaining the vouch can be 4–6 lines, so allow some breathing room).
      const vouchWindow = lines.slice(Math.max(0, i - 10), i + 1).join('\n')
      if (VOUCH_RE.test(vouchWindow)) continue

      findings.push({
        file: filePath,
        line: i + 1,
        excerpt: line.trim().slice(0, 120),
      })
    }
  }
  return findings
}

async function main(): Promise<void> {
  const tsFiles = findTsFiles(PACKAGES_DIR)
  const all: Finding[] = []
  for (const f of tsFiles) {
    all.push(...scanFile(f))
  }

  if (all.length === 0) {
    console.log('verify-no-packed-modelid-leak: 0 findings')
    return
  }

  console.error(
    `verify-no-packed-modelid-leak: ${all.length} potential leak site(s)`,
  )
  console.error('')
  console.error(
    'Each finding is a template literal that interpolates a model variable',
  )
  console.error(
    'in a file that does NOT import unpackModelId / renderModelSetting / etc.',
  )
  console.error('')
  console.error(
    'Production code must strip the `<connId>:<modelId>` prefix at the',
  )
  console.error('user-facing boundary. Pick one of:')
  console.error('  - import { unpackModelId } from .../connections.js')
  console.error('    then `const bare = unpackModelId(model).modelId`')
  console.error('  - import { renderModelSetting } from .../model.js')
  console.error('    then interpolate `renderModelSetting(model)` instead')
  console.error('')
  console.error(
    'Escape hatch (rare — only for value constructed bare by the call):',
  )
  console.error('  // modelid:bare-by-construction')
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal example for the escape-hatch documentation in the verifier output
  console.error('  const x = `Model: ${model}`')
  console.error('')
  for (const f of all) {
    const rel = relative(REPO_ROOT, f.file)
    console.error(`  ${rel}:${f.line}  ${f.excerpt}`)
  }
  process.exit(1)
}

await main()
