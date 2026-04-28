import { readdir, readFile, writeFile, cp } from 'fs/promises'
import { join } from 'path'
import { getMacroDefines } from './scripts/defines.ts'
import { getEnabledFeatures } from './scripts/default-features.ts'

const outdir = 'dist'

// Step 1: Clean output directory
const { rmSync } = await import('fs')
rmSync(outdir, { recursive: true, force: true })

// Default features come from scripts/default-features.ts (shared with
// scripts/dev.ts so the dev/build feature sets can't drift).
// Additional features can be enabled via FEATURE_<NAME>=1 env vars.
const features = getEnabledFeatures()

// Step 2: Bundle as a single file. We previously used `splitting: true` which
// fanned 510+ chunk-*.js files into dist/ — that was useful for lazy loading
// of feature-gated paths but produced an unreadable 35MB tree of opaque
// chunks. With `splitting: false` we get one self-contained `dist/cli.js`
// (~13MB minified, ~25MB unminified). Cold-start penalty is negligible
// because Bun's parser is fast and the whole bundle is mmap'd. Build the
// standalone executable separately via `bun run build:standalone` (uses
// `bun build --compile`), which is the right deliverable for "single-file
// distribution that doesn't need Node/Bun installed".
const result = await Bun.build({
  entrypoints: ['packages/cli/src/entry/cli.tsx'],
  outdir,
  target: 'bun',
  splitting: false,
  minify: process.env.BUILD_MINIFY !== 'false',
  define: getMacroDefines(),
  features,
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

// Step 3: Post-process — replace Bun-only `import.meta.require` with Node.js compatible version
const files = await readdir(outdir)
const IMPORT_META_REQUIRE = 'var __require = import.meta.require;'
const COMPAT_REQUIRE = `var __require = typeof import.meta.require === "function" ? import.meta.require : (await import("module")).createRequire(import.meta.url);`

let patched = 0
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const filePath = join(outdir, file)
  const content = await readFile(filePath, 'utf-8')
  if (content.includes(IMPORT_META_REQUIRE)) {
    await writeFile(
      filePath,
      content.replace(IMPORT_META_REQUIRE, COMPAT_REQUIRE),
    )
    patched++
  }
}

console.log(
  `Bundled ${result.outputs.length} files to ${outdir}/ (patched ${patched} for Node.js compat)`,
)

// Step 4: Native .node addon files.
//
// Bun's bundler auto-emits these as hash-named files into `dist/` whenever
// it sees a static `require('<literal-path>.node')` call — see the
// hardcoded require literals in:
//   - packages/audio-capture-napi/src/index.ts
//   - packages/image-processor-napi/src/index.ts
//
// Both dev-mode (`bun dist/cli.js`) and standalone binaries
// (`build-platforms.ts`) get the .node files automatically — no manual
// copy needed. The cli.js bundle references them by hash filename
// alongside itself, so they must stay in dist/ root.
//
// Source of truth: `packages/<pkg>/vendor/`. See NOTICE.md in each.

// Step 4.1: Copy pre-downloaded ripgrep binary into dist when available.
// This keeps Glob/Grep working in local dist runs without requiring a separate
// post-build download step.
const ripgrepSourceDir = 'packages/shell/vendor/ripgrep'
const ripgrepTargetDir = join(outdir, 'vendor', 'ripgrep')
try {
  await cp(ripgrepSourceDir, ripgrepTargetDir, { recursive: true })
  console.log(`Copied ${ripgrepSourceDir}/ → ${ripgrepTargetDir}/`)
} catch {
  // Optional artifact; postinstall/download-ripgrep handles missing binaries.
}

// (npm-postinstall download-ripgrep step removed — distribution is now
// standalone binaries via install.sh; ripgrep is copied at build time.)
