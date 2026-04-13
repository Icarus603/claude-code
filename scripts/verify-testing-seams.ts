/**
 * verify-testing-seams.ts — V7 §9.11 Testing Seams Policy
 *
 * Asserts that every owner package listed in ACTIVE_PACKAGES exposes a
 * /testing subpath via package.json#exports, the entry file exists, is not
 * empty, and does not reach into the package's internal/ subtree.
 *
 * Per V7 §9.11:
 *   - Each owner publishes packages/<owner>/testing/index.ts
 *   - Other packages' tests may import only from <owner>/testing
 *   - testing/ MUST NOT import from <owner>/internal/
 *
 * The ACTIVE_PACKAGES allowlist starts empty: as each package graduates
 * (drains its app-compat budget AND publishes a real /testing fake), it gets
 * added here in the same commit that lands the fake. Until then this verifier
 * is a no-op pass — that's intentional: V7 §13 says doctor must reflect real
 * state, never pretend.
 *
 * To add a package: append its name to ACTIVE_PACKAGES below in the SAME
 * commit that creates packages/<name>/testing/index.ts with real fakes.
 */

import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

// V7 §9.11 table — every owner that must eventually publish /testing.
// Each entry maps to a subset of fake names that V7 names explicitly.
const KNOWN_OWNERS: Record<string, readonly string[]> = {
  provider: ['InMemoryProvider', 'ErroringProvider', 'SlowProvider'],
  'mcp-runtime': ['InMemoryMcpRuntime'],
  storage: ['MemoryStorageBackend'],
  output: ['CapturingOutputTarget'],
  permission: ['AllowAllPermission', 'DenyAllPermission', 'ScriptedPermission'],
  'tool-registry': ['StubRegistry'],
  'command-runtime': ['StubCommandRuntime'],
  'local-observability': ['NullObservability', 'RecordingObservability'],
  config: ['InMemoryConfig'],
}

// Allowlist of packages whose /testing subpath is REQUIRED to be real (not
// a placeholder `export {}`). Add a name here when its real fakes land.
const ACTIVE_PACKAGES: ReadonlySet<string> = new Set<string>([
  'local-observability',
  'config',
  'storage',
  'output',
])

type Violation = { package: string; reason: string }

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

async function verifyPackage(name: string): Promise<Violation[]> {
  const violations: Violation[] = []
  const pkgRoot = resolve('packages', name)
  const pkgJsonPath = join(pkgRoot, 'package.json')

  if (!(await fileExists(pkgJsonPath))) {
    return [{ package: name, reason: `package.json not found at ${pkgJsonPath}` }]
  }

  const raw = await readFile(pkgJsonPath, 'utf8')
  let pkg: { exports?: Record<string, string> }
  try {
    pkg = JSON.parse(raw)
  } catch (err) {
    return [
      {
        package: name,
        reason: `package.json is not valid JSON: ${(err as Error).message}`,
      },
    ]
  }

  const testingExport = pkg.exports?.['./testing']
  // Only ACTIVE packages must DECLARE the export. Pending packages may
  // adopt it later — we don't pre-fail them on missing declaration, but
  // we DO still enforce content rules below if the export already exists.
  if (!testingExport) {
    if (ACTIVE_PACKAGES.has(name)) {
      violations.push({
        package: name,
        reason: `package.json#exports['./testing'] not declared (V7 §9.11)`,
      })
    }
    return violations
  }

  const testingPath = resolve(pkgRoot, testingExport.replace(/^\.\//, ''))
  if (!(await fileExists(testingPath))) {
    violations.push({
      package: name,
      reason: `exports['./testing'] points to ${testingExport} but file does not exist`,
    })
    return violations
  }

  const testingContent = await readFile(testingPath, 'utf8')

  // Active packages must have non-placeholder content. Placeholder = file
  // that only declares `export {}` plus comments — not a real fake.
  if (ACTIVE_PACKAGES.has(name)) {
    const stripped = testingContent
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/\s+/g, '')
    if (stripped === 'export{}' || stripped === '') {
      violations.push({
        package: name,
        reason: `${testingExport} is a placeholder (only export {}). V7 §9.11 requires real in-memory fakes for active owners.`,
      })
    }

    const expected = KNOWN_OWNERS[name] ?? []
    for (const fake of expected) {
      if (!testingContent.includes(fake)) {
        violations.push({
          package: name,
          reason: `${testingExport} does not export ${fake} (V7 §9.11 expected fake for ${name})`,
        })
      }
    }
  }

  // V7 §9.11 hard rule (applies to ALL packages with a /testing subpath,
  // active or not): testing/ must not import from the package's internal/.
  // The point is to prevent the fake from re-using private implementation
  // shortcuts that other packages can't see.
  const internalImportRe =
    /from\s+['"]\.\.\/(?:src\/)?internal\//
  if (internalImportRe.test(testingContent)) {
    violations.push({
      package: name,
      reason: `${testingExport} imports from internal/ (V7 §9.11 forbids this — testing must use only the public contracts)`,
    })
  }

  // Surface unused dirname import warning by referencing it (defensive).
  void dirname

  return violations
}

async function main(): Promise<void> {
  const allViolations: Violation[] = []
  for (const name of Object.keys(KNOWN_OWNERS)) {
    const v = await verifyPackage(name)
    allViolations.push(...v)
  }

  if (allViolations.length > 0) {
    const list = allViolations
      .map(v => `  - ${v.package}: ${v.reason}`)
      .join('\n')
    throw new Error(
      `verify-testing-seams: ${allViolations.length} violation(s)\n${list}\n\n` +
        `V7 §9.11 — every owner package publishes /testing subpath with in-memory fakes.\n` +
        `ACTIVE_PACKAGES allowlist controls whether placeholder content is acceptable.\n` +
        `See scripts/verify-testing-seams.ts.`,
    )
  }

  const total = Object.keys(KNOWN_OWNERS).length
  const active = ACTIVE_PACKAGES.size
  console.log(
    `verify-testing-seams: ${total} owner(s) inspected, ${active} active, ${total - active} placeholder-allowed`,
  )
}

await main()
