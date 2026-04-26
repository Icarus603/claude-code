#!/usr/bin/env bun
/**
 * Build standalone executable binaries for all supported platforms via
 * `bun build --compile --target=bun-<os>-<arch>`. Each binary is fully
 * self-contained: includes the Bun runtime + all bundled JS, so users
 * don't need Node, Bun, or npm to run `ccb`.
 *
 * Output: dist/binaries/ccb-<os>-<arch>[.exe]
 *
 * Usage:
 *   bun run scripts/build-platforms.ts             # all 5 platforms
 *   bun run scripts/build-platforms.ts darwin-arm64  # one platform
 */

import { mkdir, stat } from 'fs/promises'
import { join, basename } from 'path'
import { spawn } from 'child_process'

const OUT_DIR = 'dist/binaries'
const ENTRY = 'packages/cli/src/entry/cli.tsx'

type Target = {
  bunTarget: string
  outName: string
}

const ALL_TARGETS: Target[] = [
  { bunTarget: 'bun-darwin-arm64', outName: 'ccb-darwin-arm64' },
  { bunTarget: 'bun-darwin-x64', outName: 'ccb-darwin-x64' },
  { bunTarget: 'bun-linux-arm64', outName: 'ccb-linux-arm64' },
  { bunTarget: 'bun-linux-x64', outName: 'ccb-linux-x64' },
  { bunTarget: 'bun-windows-x64', outName: 'ccb-windows-x64.exe' },
]

function buildOne(target: Target): Promise<void> {
  return new Promise((resolve, reject) => {
    const outPath = join(OUT_DIR, target.outName)
    console.log(`[${target.outName}] building...`)
    const start = Date.now()
    const child = spawn(
      'bun',
      [
        'build',
        '--compile',
        '--minify',
        `--target=${target.bunTarget}`,
        `--outfile=${outPath}`,
        ENTRY,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    child.stdout.on('data', () => {})
    child.on('exit', code => {
      if (code !== 0) {
        reject(new Error(`bun build exited ${code} for ${target.outName}`))
        return
      }
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      stat(outPath)
        .then(s => {
          const mb = (s.size / 1024 / 1024).toFixed(1)
          console.log(`[${target.outName}] ${mb} MB · ${elapsed}s`)
          resolve()
        })
        .catch(reject)
    })
  })
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })

  // Filter to a specific platform if passed as argv
  const filter = process.argv[2]
  const targets = filter
    ? ALL_TARGETS.filter(t => t.outName.includes(filter))
    : ALL_TARGETS

  if (targets.length === 0) {
    console.error(`No matching platform for "${filter}". Known:`)
    for (const t of ALL_TARGETS) console.error(`  ${basename(t.outName, '.exe')}`)
    process.exit(1)
  }

  // Bun build is single-threaded per invocation but cheap enough that
  // sequential builds finish in ~10s total. Parallel would race on stdout.
  for (const t of targets) {
    await buildOne(t)
  }

  console.log(`\nBuilt ${targets.length} binaries → ${OUT_DIR}/`)
}

await main()
