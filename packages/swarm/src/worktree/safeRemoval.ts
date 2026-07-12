import { lstat, readdir, unlink } from 'fs/promises'
import { join } from 'path'

/** Unlink Windows junctions/symlinks before git recursively removes a worktree. */
export async function unlinkWindowsReparsePoints(root: string): Promise<void> {
  if (process.platform !== 'win32') return
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries.map(async entry => {
      const path = join(root, entry.name)
      const info = await lstat(path).catch(() => null)
      if (!info) return
      if (info.isSymbolicLink()) {
        await unlink(path).catch(() => {})
      } else if (info.isDirectory()) {
        await unlinkWindowsReparsePoints(path)
      }
    }),
  )
}
