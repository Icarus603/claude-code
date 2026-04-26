#!/usr/bin/env bun
/**
 * verify-package-readme — every packages/<X>/ with a package.json must
 * have a README.md describing its V7 responsibility. Keeps the public
 * surface self-documenting for future maintainers.
 */

import { readdir, stat } from 'fs/promises'

const missing: string[] = []
for (const entry of await readdir('packages')) {
  // Skip @ant — scoped namespace, packages live one level deeper.
  if (entry === '@ant') {
    for (const sub of await readdir('packages/@ant')) {
      const dir = `packages/@ant/${sub}`
      if (!(await stat(dir)).isDirectory()) continue
      try {
        await stat(`${dir}/package.json`)
      } catch {
        continue
      }
      try {
        await stat(`${dir}/README.md`)
      } catch {
        missing.push(dir)
      }
    }
    continue
  }
  const dir = `packages/${entry}`
  if (!(await stat(dir)).isDirectory()) continue
  try {
    await stat(`${dir}/package.json`)
  } catch {
    continue
  }
  try {
    await stat(`${dir}/README.md`)
  } catch {
    missing.push(dir)
  }
}

if (missing.length > 0) {
  console.error(`✗ package-readme: ${missing.length} package(s) missing README.md:`)
  for (const dir of missing) console.error(`  ${dir}`)
  console.error('\nAdd a README.md describing the package responsibility.')
  process.exit(1)
}
console.log('package-readme check passed')
