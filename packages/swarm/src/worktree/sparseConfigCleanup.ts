import { execFileNoThrowWithCwd, gitExe } from '../adapters/appRuntime.js'

export async function cleanupSparseWorktreeConfig(
  gitRoot: string,
): Promise<void> {
  const worktrees = await execFileNoThrowWithCwd(
    gitExe(),
    ['worktree', 'list', '--porcelain'],
    { cwd: gitRoot },
  )
  const count = worktrees.stdout.split('\n').filter(line => line.startsWith('worktree ')).length
  if (worktrees.code !== 0 || count > 1) return

  const mainSparse = await execFileNoThrowWithCwd(
    gitExe(),
    ['config', '--worktree', '--get', 'core.sparseCheckout'],
    { cwd: gitRoot },
  )
  if (mainSparse.stdout.trim() === 'true') return
  await execFileNoThrowWithCwd(
    gitExe(),
    ['config', '--unset', 'extensions.worktreeConfig'],
    { cwd: gitRoot },
  )
}
