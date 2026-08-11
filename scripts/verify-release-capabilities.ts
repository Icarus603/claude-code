#!/usr/bin/env bun
/**
 * Keep release-visible feature flags away from known transition stubs.
 *
 * Some reconstructed modules deliberately preserve upstream type shapes while
 * their runtime is still unavailable. That is acceptable only while the
 * corresponding feature remains absent from the default release build.
 */

import { getEnabledFeatures } from './default-features.ts'

const enabled = new Set(getEnabledFeatures({}))

const gatedTransitionSurfaces = new Map<string, readonly string[]>([
  [
    'DIRECT_CONNECT',
    [
      'packages/server/src/server.ts',
      'packages/server/src/connectHeadless.ts',
      'packages/server/src/sessionManager.ts',
    ],
  ],
  [
    'SSH_REMOTE',
    [
      'packages/cli/src/ssh/createSSHSession.ts',
      'packages/cli/src/ssh/SSHSessionManager.ts',
    ],
  ],
])

const failures: string[] = []
for (const [feature, files] of gatedTransitionSurfaces) {
  if (!enabled.has(feature)) continue
  failures.push(
    `${feature} is enabled by default while its runtime remains transitional:\n` +
      files.map(file => `  - ${file}`).join('\n'),
  )
}

if (failures.length > 0) {
  console.error('release-capabilities: FAIL')
  console.error(failures.join('\n\n'))
  console.error(
    '\nImplement and test the listed runtime first, or keep the feature out of STABLE_FEATURES.',
  )
  process.exit(1)
}

console.log(
  `release-capabilities: OK (${gatedTransitionSurfaces.size} transitional surfaces remain gated)`,
)
