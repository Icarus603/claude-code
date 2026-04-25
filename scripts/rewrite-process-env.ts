#!/usr/bin/env bun
/**
 * Rewrite `process.env.X` reads → `readEnv('X')` in core-domain packages,
 * adding the import as needed. Skips writes (`process.env.X = ...`).
 *
 * V7 §8.6 — core-domain packages must go through config for env access.
 */

import { readFile, writeFile } from 'fs/promises'

const TARGETS = [
  'packages/agent',
  'packages/provider',
  'packages/permission',
  'packages/memory',
  'packages/config',
  'packages/command-runtime',
  'packages/mcp-runtime',
  'packages/tool-registry',
]

const BUILD_DEFINES = new Set([
  'NODE_ENV', 'BUN_ENV',
])

async function collectFiles(root: string): Promise<string[]> {
  const proc = Bun.spawn([
    'find', root, '-type', 'f',
    '(', '-name', '*.ts', '-o', '-name', '*.tsx', ')',
    '-not', '-path', '*/node_modules/*',
    '-not', '-path', '*/dist/*',
    '-not', '-path', '*/__tests__/*',
  ], { stdout: 'pipe' })
  const out = await new Response(proc.stdout).text()
  return out.split('\n').map(s => s.trim()).filter(Boolean)
}

let totalRewrites = 0
let touchedFiles = 0

for (const root of TARGETS) {
  const files = await collectFiles(root)
  for (const f of files) {
    let content: string
    try { content = await readFile(f, 'utf8') } catch { continue }
    let rewrites = 0
    const newLines = content.split('\n').map(line => {
      // Skip writes
      if (/\bprocess\.env\.[A-Z_][A-Z0-9_]*\s*=[^=]/.test(line)) return line
      if (/\bprocess\.env\[['"][^'"]+['"]\]\s*=[^=]/.test(line)) return line
      // Skip comments
      const t = line.trimStart()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return line
      return line.replace(/\bprocess\.env\.([A-Z_][A-Z0-9_]*)/g, (full, name) => {
        if (BUILD_DEFINES.has(name)) return full
        rewrites++
        return `readEnv('${name}')`
      })
    })
    if (rewrites === 0) continue
    let newContent = newLines.join('\n')
    // Add import if missing
    if (!/from\s+['"]@claude-code\/config\/env\/utils['"]/.test(newContent)) {
      // Find a good spot: after the last import line
      const lines = newContent.split('\n')
      let lastImport = -1
      for (let i = 0; i < lines.length; i++) {
        if (/^import\s/.test(lines[i]!)) lastImport = i
      }
      if (lastImport >= 0) {
        lines.splice(lastImport + 1, 0, "import { readEnv } from '@claude-code/config/env/utils'")
        newContent = lines.join('\n')
      }
    }
    await writeFile(f, newContent)
    totalRewrites += rewrites
    touchedFiles++
  }
}

console.log(`Rewrote ${totalRewrites} process.env reads across ${touchedFiles} files`)
