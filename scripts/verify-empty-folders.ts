/**
 * verify-empty-folders.ts — V7 §19.5
 *
 * Reports empty directories under packages/ as a stale-scaffold smell.
 * Empty subtrees are usually leftovers from earlier refactor attempts that
 * confuse navigation and obscure the real package layout. V7 wants them
 * cleaned up at Wave 0 Prep and prevented from re-accreting.
 *
 * Exits non-zero if any empty directory is found anywhere in packages/.
 */

import { readdir } from 'fs/promises'
import { join } from 'path'

async function findEmptyDirs(root: string): Promise<string[]> {
  const empties: string[] = []
  async function walk(dir: string): Promise<boolean> {
    let entries: { name: string; isDirectory: () => boolean }[] = []
    try {
      const dirents = await readdir(dir, { withFileTypes: true })
      entries = dirents
    } catch {
      return false
    }
    if (entries.length === 0) {
      empties.push(dir)
      return true
    }
    let allSubtreesEmpty = true
    let hadFiles = false
    for (const entry of entries) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        const subtreeEmpty = await walk(child)
        if (!subtreeEmpty) allSubtreesEmpty = false
      } else {
        hadFiles = true
        allSubtreesEmpty = false
      }
    }
    return !hadFiles && allSubtreesEmpty
  }
  await walk(root)
  return empties
}

async function main(): Promise<void> {
  const empties = await findEmptyDirs('packages')
  if (empties.length > 0) {
    const list = empties.map((p) => `  - ${p}`).join('\n')
    throw new Error(
      `Found ${empties.length} empty directory(ies) under packages/.\n` +
        `V7 §19.5 forbids stale empty scaffolds. Run:\n` +
        `  find packages -type d -empty -delete\n\n` +
        `Empty directories:\n${list}`,
    )
  }
  console.log('empty folder verification passed')
}

await main()
