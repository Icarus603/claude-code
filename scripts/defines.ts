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
  return {
    'MACRO.VERSION': JSON.stringify(resolveVersion()),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify(''),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify(''),
    'MACRO.NATIVE_PACKAGE_URL': JSON.stringify(''),
    'MACRO.PACKAGE_URL': JSON.stringify(''),
    'MACRO.VERSION_CHANGELOG': JSON.stringify(''),
  }
}
