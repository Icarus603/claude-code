/**
 * verify-error-namespaces.ts — V7 §6.5 / §3.8 Typed Error Namespaces
 *
 * Asserts that every owner package listed in ACTIVE_PACKAGES exports a
 * BaseError class plus the typed subtype set defined in V7 §6.5 table.
 *
 * Per V7 §3.8 + §6.5:
 *   - Each subsystem owner exports an error namespace
 *   - Each error class extends a package-specific BaseError
 *   - Each error carries `code: string` (stable, for log/CI matching)
 *   - Hosts use `instanceof` checks, NEVER string matching on error.message
 *
 * The ACTIVE_PACKAGES allowlist starts empty. As each owner adds the typed
 * error namespace (Wave 3 in TEAM_PLAN/v7-refactor-plan.md), it gets added
 * to the allowlist in the SAME commit that creates the error file. Until
 * then this verifier is a no-op pass.
 *
 * To activate a package:
 *   1. Create packages/<name>/contracts/errors.ts (or src/contracts/errors.ts)
 *   2. Export BaseError class extending Error with `code: string`
 *   3. Export each subtype from the V7 §6.5 table for that namespace
 *   4. Re-export the namespace from the package public surface
 *   5. Append the package name to ACTIVE_PACKAGES below
 *   6. Run `bun run doctor:arch --only error-namespaces` and verify it passes
 */

import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// V7 §6.5 table — every owner that must eventually export a typed error
// namespace, plus the subtype names V7 names explicitly.
type Spec = { base: string; subtypes: readonly string[] }
const KNOWN_OWNERS: Record<string, Spec> = {
  provider: {
    base: 'ProviderBaseError',
    subtypes: [
      'AuthError',
      'RateLimitError',
      'ContextOverflowError',
      'UpstreamError',
      'StreamError',
    ],
  },
  permission: {
    base: 'PermissionBaseError',
    subtypes: ['DeniedError', 'AskRequiredError', 'ContextError'],
  },
  'tool-registry': {
    base: 'ToolBaseError',
    subtypes: ['NotFoundError', 'InvalidInputError', 'ExecutionError'],
  },
  'mcp-runtime': {
    base: 'McpBaseError',
    subtypes: [
      'TransportError',
      'ProtocolError',
      'AuthRequiredError',
      'ElicitationError',
    ],
  },
  storage: {
    base: 'StorageBaseError',
    subtypes: ['NotFoundError', 'ConflictError', 'BackendError'],
  },
  shell: {
    base: 'ShellBaseError',
    subtypes: ['ExecError', 'TimeoutError', 'QuotingError'],
  },
  config: {
    base: 'ConfigBaseError',
    subtypes: ['ValidationError', 'NotFoundError', 'PermissionDeniedError'],
  },
  // V7 §6.5 marks UserAbort as a singleton symbol marker, NOT a class.
  // The agent verifier looks for that symbol export specifically.
  agent: {
    base: 'UserAbort',
    subtypes: [],
  },
}

// Packages whose error namespace MUST be present and complete. Add a name
// here in the same commit that lands the contracts/errors.ts file.
const ACTIVE_PACKAGES: ReadonlySet<string> = new Set<string>([
  'config',
  'permission',
  'provider',
  'shell',
  'storage',
  'tool-registry',
])

type Violation = { package: string; reason: string }

// Search likely locations for the package's error file. We accept any of:
//   - packages/<name>/contracts/errors.ts
//   - packages/<name>/src/contracts/errors.ts
//   - packages/<name>/src/contracts.ts (if errors are inlined into contracts)
//   - packages/<name>/contracts.ts
const ERROR_FILE_CANDIDATES = (name: string): string[] => [
  `packages/${name}/errors.ts`,
  `packages/${name}/src/errors.ts`,
  `packages/${name}/contracts/errors.ts`,
  `packages/${name}/src/contracts/errors.ts`,
  `packages/${name}/src/contracts.ts`,
  `packages/${name}/contracts.ts`,
]

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

async function findErrorFile(name: string): Promise<string | null> {
  for (const candidate of ERROR_FILE_CANDIDATES(name)) {
    if (await fileExists(candidate)) return candidate
  }
  return null
}

async function verifyPackage(name: string, spec: Spec): Promise<Violation[]> {
  const violations: Violation[] = []
  const filePath = await findErrorFile(name)

  if (!filePath) {
    if (ACTIVE_PACKAGES.has(name)) {
      violations.push({
        package: name,
        reason:
          `no errors file found in ${ERROR_FILE_CANDIDATES(name).join(', ')}`,
      })
    }
    return violations
  }

  const content = await readFile(filePath, 'utf8')

  if (!ACTIVE_PACKAGES.has(name)) return violations

  // For active agent: look for the UserAbort symbol declaration.
  if (name === 'agent') {
    if (!/UserAbort\s*[:=]\s*(unique\s+)?symbol/.test(content) &&
      !/export\s+const\s+UserAbort\s*=\s*Symbol/.test(content)) {
      violations.push({
        package: name,
        reason:
          `${filePath} does not export UserAbort as a unique symbol (V7 §6.5)`,
      })
    }
    return violations
  }

  // For everyone else: look for BaseError class + each subtype.
  if (!new RegExp(`class\\s+${spec.base}\\s+extends\\s+Error`).test(content)) {
    violations.push({
      package: name,
      reason: `${filePath} does not declare class ${spec.base} extends Error (V7 §6.5)`,
    })
  }

  for (const subtype of spec.subtypes) {
    if (!new RegExp(`class\\s+${subtype}\\s+extends\\s+${spec.base}`).test(content)) {
      violations.push({
        package: name,
        reason: `${filePath} does not declare class ${subtype} extends ${spec.base} (V7 §6.5)`,
      })
    }
  }

  // V7 §3.8: each error must carry a `code: string`. We approximate by
  // requiring the BaseError to declare a `code` property.
  if (!/code\s*:\s*string/.test(content)) {
    violations.push({
      package: name,
      reason: `${filePath} does not declare \`code: string\` on the error base (V7 §3.8)`,
    })
  }

  // unused but kept for future absolute-path use
  void resolve
  void join

  return violations
}

async function main(): Promise<void> {
  const allViolations: Violation[] = []
  for (const [name, spec] of Object.entries(KNOWN_OWNERS)) {
    const v = await verifyPackage(name, spec)
    allViolations.push(...v)
  }

  if (allViolations.length > 0) {
    const list = allViolations
      .map(v => `  - ${v.package}: ${v.reason}`)
      .join('\n')
    throw new Error(
      `verify-error-namespaces: ${allViolations.length} violation(s)\n${list}\n\n` +
        `V7 §6.5 — each owner exports a typed error namespace.\n` +
        `V7 §3.8 — host code must use instanceof, never string-match error.message.\n` +
        `ACTIVE_PACKAGES allowlist controls enforcement.\n` +
        `See scripts/verify-error-namespaces.ts.`,
    )
  }

  const total = Object.keys(KNOWN_OWNERS).length
  const active = ACTIVE_PACKAGES.size
  console.log(
    `verify-error-namespaces: ${total} owner(s) inspected, ${active} active, ${total - active} pending`,
  )
}

await main()
