/**
 * Shared MACRO define map used by both dev.ts (runtime -d flags)
 * and build.ts (Bun.build define option).
 *
 * MACRO.VERSION is derived from the latest reachable git tag — the
 * single source of truth for releases. To cut a release, run
 * `bun run release v1.carus.001` (creates the tag and pushes; CI
 * picks up the tag and builds binaries with this exact version baked in).
 *
 * Fallback chain when no tag is reachable (shallow clone, fresh repo):
 *   1. CCB_VERSION env var (CI override / local pinning)
 *   2. "0.0.0-dev"
 */

import { spawnSync } from 'node:child_process'

function resolveVersion(): string {
  const override = process.env.CCB_VERSION
  if (override) return override.replace(/^v/, '')
  const git = spawnSync('git', ['describe', '--tags', '--abbrev=0'], {
    encoding: 'utf8',
  })
  if (git.status === 0) {
    const tag = git.stdout.trim()
    if (tag) return tag.replace(/^v/, '')
  }
  return '0.0.0-dev'
}

export function getMacroDefines(): Record<string, string> {
  // Pin `process.env.NODE_ENV` at build time so production-vs-dev
  // branches in the bundle don't fall through to dev. Bun's default
  // when NODE_ENV is unset at build time is `"development"`, which
  // dead-code-eliminated the entire NativeAutoUpdater body
  // (everything past the `process.env.NODE_ENV === 'development'`
  // early-return) — auto-update silently never ran in any release
  // binary. Same hazard applies to anything else gated on NODE_ENV.
  // For dev-mode runs (`bun run dev`), scripts/dev.ts overrides this
  // by leaving NODE_ENV at the runtime value the shell provides.
  const isDevBuild = process.env.NODE_ENV === 'development'
  return {
    'MACRO.VERSION': JSON.stringify(resolveVersion()),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify(''),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify(''),
    'MACRO.NATIVE_PACKAGE_URL': JSON.stringify(''),
    'MACRO.PACKAGE_URL': JSON.stringify(''),
    'MACRO.VERSION_CHANGELOG': JSON.stringify(''),
    'process.env.NODE_ENV': JSON.stringify(
      isDevBuild ? 'development' : 'production',
    ),
  }
}
