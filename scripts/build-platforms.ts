#!/usr/bin/env bun
/**
 * Build standalone executable binaries for all supported platforms via
 * `Bun.build({ compile: { target, outfile } })`. Each binary is fully
 * self-contained: includes the Bun runtime + all bundled JS, so users
 * don't need Node, Bun, or npm to run `ccb`.
 *
 * IMPORTANT: this MUST go through the programmatic Bun.build API, not the
 * `bun build --compile` CLI — the CLI does not accept --define or
 * --features, so binaries built via `bun build --compile` ship with empty
 * MACRO.* placeholders and `feature(...)` returning false everywhere
 * (which silently disables auto mode, plan mode, voice, etc.).
 *
 * Output: dist/binaries/ccb-<os>-<arch>[.exe]
 */

import { mkdir, stat } from 'fs/promises'
import { join, basename } from 'path'
import { getMacroDefines } from './defines.ts'
import { getEnabledFeatures } from './default-features.ts'

const OUT_DIR = 'dist/binaries'
const ENTRY = 'packages/cli/src/entry/cli.tsx'

type Target = {
  bunTarget: `bun-${string}`
  outName: string
}

const ALL_TARGETS: Target[] = [
  { bunTarget: 'bun-darwin-arm64', outName: 'ccb-darwin-arm64' },
  { bunTarget: 'bun-darwin-x64', outName: 'ccb-darwin-x64' },
  { bunTarget: 'bun-linux-arm64', outName: 'ccb-linux-arm64' },
  { bunTarget: 'bun-linux-x64', outName: 'ccb-linux-x64' },
  { bunTarget: 'bun-windows-x64', outName: 'ccb-windows-x64.exe' },
]

// Single source of truth via scripts/default-features.ts — also used by
// scripts/dev.ts and build.ts. A previous local DEFAULT_BUILD_FEATURES
// drifted out of sync (KAIROS_DREAM/PUSH/LOOP_DYNAMIC missing), shipping
// release binaries with those subsystems silently disabled despite STABLE
// status; CLAUDE.md flagged the SSOT but build-platforms.ts hadn't yet
// been migrated. Don't reintroduce a local list.
const features = getEnabledFeatures()

async function buildOne(target: Target): Promise<void> {
  const outPath = join(OUT_DIR, target.outName)
  console.log(`[${target.outName}] building...`)
  const start = Date.now()
  // Bun.build's `compile` option accepts the target triple + output path.
  // Programmatic API is required because `bun build --compile` CLI has no
  // flags for --define or --features.
  const result = await Bun.build({
    entrypoints: [ENTRY],
    // @ts-expect-error -- compile is a valid option in Bun >=1.2 but the
    // shipped @types/bun in this project doesn't include it yet.
    compile: { target: target.bunTarget, outfile: outPath },
    define: getMacroDefines(),
    features,
    minify: true,
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`Bun.build failed for ${target.outName}`)
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  const s = await stat(outPath)
  const mb = (s.size / 1024 / 1024).toFixed(1)
  console.log(`[${target.outName}] ${mb} MB · ${elapsed}s`)
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })
  const filter = process.argv[2]
  let targets: Target[]
  if (filter === '--current') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const os =
      process.platform === 'darwin'
        ? 'darwin'
        : process.platform === 'win32'
          ? 'windows'
          : 'linux'
    targets = ALL_TARGETS.filter(t => t.outName.includes(`${os}-${arch}`))
  } else if (filter) {
    targets = ALL_TARGETS.filter(t => t.outName.includes(filter))
  } else {
    targets = ALL_TARGETS
  }
  if (targets.length === 0) {
    console.error(`No matching platform for "${filter}". Known:`)
    for (const t of ALL_TARGETS) console.error(`  ${basename(t.outName, '.exe')}`)
    process.exit(1)
  }
  for (const t of targets) {
    await buildOne(t)
  }
  console.log(`\nBuilt ${targets.length} binaries → ${OUT_DIR}/`)
}

await main()
