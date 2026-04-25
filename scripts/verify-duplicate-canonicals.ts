#!/usr/bin/env bun
/**
 * verify-duplicate-canonicals — detect same-name files in src/ AND packages/
 * that both contain real implementations.
 *
 * Discovered 2026-04-26: src/utils/bash/bashParser.ts and
 * packages/shell/src/bash/bashParser.ts both held 4400+ LOC of parser
 * implementation that had silently diverged by 4 lines. Forks like this
 * are invisible to runtime-boundaries (each path is internally consistent).
 *
 * Heuristic: same basename, both files ≥ 100 LOC, size within 50% of each
 * other. Tighter than basename-only — types.ts and index.ts collide too
 * trivially otherwise.
 *
 * Usage: bun run scripts/verify-duplicate-canonicals.ts
 */

import { readFile } from 'fs/promises'

async function collectFiles(root: string): Promise<string[]> {
  const proc = Bun.spawn([
    'find', root, '-type', 'f',
    '(', '-name', '*.ts', '-o', '-name', '*.tsx', ')',
    '-not', '-path', '*/node_modules/*',
    '-not', '-path', '*/dist/*',
    '-not', '-path', '*/__tests__/*',
    '-not', '-path', '*/types/generated/*',
  ], { stdout: 'pipe' })
  const out = await new Response(proc.stdout).text()
  return out.split('\n').map(s => s.trim()).filter(Boolean)
}

async function main() {
  const [srcFiles, pkgFiles] = await Promise.all([
    collectFiles('src'),
    collectFiles('packages'),
  ])

  const srcByName = new Map<string, string[]>()
  for (const f of srcFiles) {
    const name = f.split('/').pop()!
    const arr = srcByName.get(name) ?? []
    arr.push(f); srcByName.set(name, arr)
  }
  const pkgByName = new Map<string, string[]>()
  for (const f of pkgFiles) {
    const name = f.split('/').pop()!
    const arr = pkgByName.get(name) ?? []
    arr.push(f); pkgByName.set(name, arr)
  }

  const dupes: Array<{ src: string; pkg: string; sLoc: number; pLoc: number }> = []

  for (const [name, srcs] of srcByName) {
    const pkgs = pkgByName.get(name)
    if (!pkgs) continue
    for (const s of srcs) {
      const sContent = await readFile(s, 'utf8').catch(() => '')
      const sLoc = sContent.split('\n').length
      if (sLoc < 100) continue
      for (const p of pkgs) {
        const pContent = await readFile(p, 'utf8').catch(() => '')
        const pLoc = pContent.split('\n').length
        if (pLoc < 100) continue
        const ratio = Math.min(sLoc, pLoc) / Math.max(sLoc, pLoc)
        if (ratio < 0.5) continue
        // Content-similarity gate: require ≥ 30% shared non-trivial lines
        // to filter out same-basename collisions (8 different `types.ts`,
        // 3 different `prefix.ts`, etc).
        const sLines = new Set(
          sContent.split('\n').map(l => l.trim()).filter(l => l.length > 5),
        )
        const pLines = new Set(
          pContent.split('\n').map(l => l.trim()).filter(l => l.length > 5),
        )
        let common = 0
        for (const l of sLines) if (pLines.has(l)) common++
        const overlap = common / Math.min(sLines.size, pLines.size)
        if (overlap < 0.3) continue
        dupes.push({ src: s, pkg: p, sLoc, pLoc })
      }
    }
  }

  if (dupes.length === 0) {
    console.log('OK — no duplicate canonicals')
    process.exit(0)
  }

  dupes.sort((a, b) => Math.max(b.sLoc, b.pLoc) - Math.max(a.sLoc, a.pLoc))
  console.log(`Found ${dupes.length} duplicate canonical pair(s):`)
  for (const d of dupes) {
    console.log(`  ${d.sLoc}/${d.pLoc} LOC  ${d.src}  ⇄  ${d.pkg}`)
  }
  console.log('')
  console.log('Each pair is a silent fork risk. Pick one as canonical, merge any')
  console.log('divergence, convert the other to a forward shim.')
  process.exit(1)
}

main().catch(e => { console.error(e); process.exit(2) })
