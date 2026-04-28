/**
 * Shared utilities for audit scripts in scripts/audit-silent-failures/.
 *
 * Each audit produces a uniform `Finding` shape:
 *   { pattern, file, line, snippet, severity, note }
 *
 * Audits dump JSON to stdout; the wrap-up script (scripts/audit-silent-failures/run-all.ts)
 * collects everything and writes docs/refactor/silent-failure-inventory.md.
 */
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface Finding {
  /** Audit pattern id, e.g. "unwired-setter-slot" */
  pattern: string
  file: string
  line: number
  /** Short single-line snippet showing the problem. */
  snippet: string
  severity: Severity
  /** Human note: what's wrong, suggested fix. */
  note: string
}

export interface AuditResult {
  pattern: string
  description: string
  totalScanned: number
  findings: Finding[]
}

/**
 * Recursively grep packages/ for a regex pattern.
 * Returns line-by-line matches with file/line/content tuples.
 */
export function grepPackages(
  pattern: string,
  options: { extensions?: string[] } = {},
): Array<{ file: string; line: number; content: string }> {
  const exts = options.extensions ?? ['*.ts', '*.tsx']
  const includes = exts.map(e => `--include='${e}'`).join(' ')
  let raw = ''
  try {
    raw = execSync(
      `grep -rEn ${includes} --exclude-dir=node_modules --exclude-dir=__tests__ '${pattern.replace(/'/g, "'\\''")}' packages 2>/dev/null || true`,
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
    )
  } catch {}
  const out: Array<{ file: string; line: number; content: string }> = []
  for (const ln of raw.split('\n')) {
    const m = ln.match(/^([^:]+):(\d+):(.*)$/)
    if (!m) continue
    out.push({ file: m[1], line: parseInt(m[2], 10), content: m[3] })
  }
  return out
}

/**
 * Find all files matching a glob via the find shell builtin.
 */
export function findFiles(
  baseDir: string,
  filename: string,
): string[] {
  let raw = ''
  try {
    raw = execSync(
      `find ${baseDir} -name '${filename}' -not -path '*/node_modules/*'`,
      { encoding: 'utf8' },
    )
  } catch {}
  return raw.trim().split('\n').filter(Boolean)
}

export function readSafe(file: string): string {
  try { return readFileSync(file, 'utf8') } catch { return '' }
}

export function emitJson(result: AuditResult): void {
  // Write JSON to stdout. Each audit script is invoked individually; the
  // wrap-up script captures stdout and merges.
  console.log(JSON.stringify(result, null, 2))
}

export function summarize(result: AuditResult): string {
  const bySev = new Map<Severity, number>()
  for (const f of result.findings) {
    bySev.set(f.severity, (bySev.get(f.severity) ?? 0) + 1)
  }
  const parts: string[] = []
  for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[]) {
    if (bySev.has(sev)) parts.push(`${sev}=${bySev.get(sev)}`)
  }
  return `${result.pattern}: ${result.findings.length} findings (${parts.join(', ') || 'none'})`
}
