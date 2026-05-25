import { spawn } from 'child_process'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import {
  execFileNoThrowWithCwd,
  execSyncWithDefaults,
} from './execFileNoThrow.js'

// This file contains platform-agnostic implementations of common `ps` type commands.
// When adding new code to this file, make sure to handle:
// - Win32, as `ps` within cygwin and WSL may not behave as expected, particularly when attempting to access processes on the host.
// - Unix vs BSD-style `ps` have different options.

/**
 * Check if a process with the given PID is running (signal 0 probe).
 *
 * PID ≤ 1 returns false (0 is current process group, 1 is init).
 *
 * Note: `process.kill(pid, 0)` throws EPERM when the process exists but is
 * owned by another user. This reports such processes as NOT running, which
 * is conservative for lock recovery (we won't steal a live lock).
 *
 * Use `isPidAlive` instead when you need the opposite semantics — e.g. for
 * "is this bg worker still around to receive a signal" probes where EPERM
 * means "yes, process exists, just not ours to kill".
 */
export function isProcessRunning(pid: number): boolean {
  if (pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Liveness probe — like `isProcessRunning` but treats EPERM as alive.
 *
 * Use this when you only care whether SOMETHING is at the pid (e.g. bg
 * worker supervision, daemon adoption). The other-user case still
 * counts as live because we just want to know "is the pid still
 * holding"; we're not trying to take over a lock.
 *
 * PID ≤ 1 returns false (0 is current process group, 1 is init).
 */
export function isPidAlive(pid: number): boolean {
  if (pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Gets the ancestor process chain for a given process (up to maxDepth levels)
 * @param pid - The starting process ID
 * @param maxDepth - Maximum number of ancestors to fetch (default: 10)
 * @returns Array of ancestor PIDs from immediate parent to furthest ancestor
 */
export async function getAncestorPidsAsync(
  pid: string | number,
  maxDepth = 10,
): Promise<number[]> {
  if (process.platform === 'win32') {
    // For Windows, use a PowerShell script that walks the process tree
    const script = `
      $pid = ${String(pid)}
      $ancestors = @()
      for ($i = 0; $i -lt ${maxDepth}; $i++) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
        if (-not $proc -or -not $proc.ParentProcessId -or $proc.ParentProcessId -eq 0) { break }
        $pid = $proc.ParentProcessId
        $ancestors += $pid
      }
      $ancestors -join ','
    `.trim()

    const result = await execFileNoThrowWithCwd(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { timeout: 3000 },
    )
    if (result.code !== 0 || !result.stdout?.trim()) {
      return []
    }
    return result.stdout
      .trim()
      .split(',')
      .filter(Boolean)
      .map(p => parseInt(p, 10))
      .filter(p => !isNaN(p))
  }

  // For Unix, use a shell command that walks up the process tree
  // This uses a single process invocation instead of multiple sequential calls
  const script = `pid=${String(pid)}; for i in $(seq 1 ${maxDepth}); do ppid=$(ps -o ppid= -p $pid 2>/dev/null | tr -d ' '); if [ -z "$ppid" ] || [ "$ppid" = "0" ] || [ "$ppid" = "1" ]; then break; fi; echo $ppid; pid=$ppid; done`

  const result = await execFileNoThrowWithCwd('sh', ['-c', script], {
    timeout: 3000,
  })
  if (result.code !== 0 || !result.stdout?.trim()) {
    return []
  }
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(p => parseInt(p, 10))
    .filter(p => !isNaN(p))
}

/**
 * Gets the command line for a given process
 * @param pid - The process ID to get the command for
 * @returns The command line string, or null if not found
 * @deprecated Use getAncestorCommandsAsync instead
 */
export function getProcessCommand(pid: string | number): string | null {
  try {
    const pidStr = String(pid)
    const command =
      process.platform === 'win32'
        ? `powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId=${pidStr}\\").CommandLine"`
        : `ps -o command= -p ${pidStr}`

    const result = execSyncWithDefaults(command, { timeout: 1000 })
    return result ? result.trim() : null
  } catch {
    return null
  }
}

/**
 * Gets the command lines for a process and its ancestors in a single call
 * @param pid - The starting process ID
 * @param maxDepth - Maximum depth to traverse (default: 10)
 * @returns Array of command strings for the process chain
 */
export async function getAncestorCommandsAsync(
  pid: string | number,
  maxDepth = 10,
): Promise<string[]> {
  if (process.platform === 'win32') {
    // For Windows, use a PowerShell script that walks the process tree and collects commands
    const script = `
      $currentPid = ${String(pid)}
      $commands = @()
      for ($i = 0; $i -lt ${maxDepth}; $i++) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$currentPid" -ErrorAction SilentlyContinue
        if (-not $proc) { break }
        if ($proc.CommandLine) { $commands += $proc.CommandLine }
        if (-not $proc.ParentProcessId -or $proc.ParentProcessId -eq 0) { break }
        $currentPid = $proc.ParentProcessId
      }
      $commands -join [char]0
    `.trim()

    const result = await execFileNoThrowWithCwd(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { timeout: 3000 },
    )
    if (result.code !== 0 || !result.stdout?.trim()) {
      return []
    }
    return result.stdout.split('\0').filter(Boolean)
  }

  // For Unix, use a shell command that walks up the process tree and collects commands
  // Using null byte as separator to handle commands with newlines
  const script = `currentpid=${String(pid)}; for i in $(seq 1 ${maxDepth}); do cmd=$(ps -o command= -p $currentpid 2>/dev/null); if [ -n "$cmd" ]; then printf '%s\\0' "$cmd"; fi; ppid=$(ps -o ppid= -p $currentpid 2>/dev/null | tr -d ' '); if [ -z "$ppid" ] || [ "$ppid" = "0" ] || [ "$ppid" = "1" ]; then break; fi; currentpid=$ppid; done`

  const result = await execFileNoThrowWithCwd('sh', ['-c', script], {
    timeout: 3000,
  })
  if (result.code !== 0 || !result.stdout?.trim()) {
    return []
  }
  return result.stdout.split('\0').filter(Boolean)
}

/**
 * Gets the child process IDs for a given process
 * @param pid - The parent process ID
 * @returns Array of child process IDs as numbers
 */
export function getChildPids(pid: string | number): number[] {
  try {
    const pidStr = String(pid)
    const command =
      process.platform === 'win32'
        ? `powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ParentProcessId=${pidStr}\\").ProcessId"`
        : `pgrep -P ${pidStr}`

    const result = execSyncWithDefaults(command, { timeout: 1000 })
    if (!result) {
      return []
    }
    return result
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(p => parseInt(p, 10))
      .filter(p => !isNaN(p))
  } catch {
    return []
  }
}

/** Hard cap on the `ps -A` enumeration used by killProcessTree's fallback. */
const KILL_PS_ENUM_TIMEOUT_MS = 500

/**
 * Port of ant v2.1.150 `VrK` (4974.js) — failure telemetry for
 * killProcessTree. ant emits `tengu_bash_tool_kill_error` with `{stage,
 * error_code}`; ccb's shell package has no statsig wire, so we surface the
 * same signal through the debug log. `stage` distinguishes a failed group
 * kill from a failed `ps` enumeration so a stuck-process report can be
 * triaged. `errno` is only recorded when it looks like a real errno string
 * (uppercase, ESRCH/EPERM/…) to avoid logging stringified objects.
 */
function logKillFailure(stage: string, err: unknown): void {
  try {
    const errno =
      err && typeof err === 'object' && 'code' in err
        ? (err as NodeJS.ErrnoException).code
        : undefined
    const errorCode =
      typeof errno === 'string' && /^[A-Z][A-Z0-9_]*$/.test(errno)
        ? errno
        : undefined
    logForDebugging(
      `killProcessTree ${stage} failed: ${errorCode ?? String(err)}`,
    )
  } catch {
    // never let telemetry crash the kill path
  }
}

/**
 * Port of ant v2.1.150 `WOO` (4974.js) — enumerate every (pid, ppid) pair on
 * the system via a single `ps -A -o pid= -o ppid=` spawn from `/` (cwd `/`
 * avoids holding a handle on a directory that may be getting torn down).
 */
function enumeratePidPairs(): Promise<string> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], {
        cwd: '/',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch (err) {
      reject(err)
      return
    }
    let out = ''
    child.stdout?.on('data', chunk => {
      out += chunk
    })
    child.once('error', reject)
    child.once('close', () => resolve(out))
  })
}

/**
 * Port of ant v2.1.150 `POO` (4974.js) — collect the full set of descendant
 * pids of `rootPid` by parsing the system-wide (pid, ppid) table. Races the
 * `ps` spawn against a 500ms timeout so a hung `ps` can't wedge the kill
 * path; on timeout / spawn failure returns an empty set (group-kill alone
 * still reaps the common case).
 */
async function collectDescendantPids(rootPid: number): Promise<Set<number>> {
  let raw: string
  try {
    raw = await Promise.race([
      enumeratePidPairs(),
      new Promise<string>(resolve => {
        const t = setTimeout(() => resolve(''), KILL_PS_ENUM_TIMEOUT_MS)
        if (typeof t === 'object') t.unref()
      }),
    ])
  } catch (err) {
    logKillFailure('enum_spawn', err)
    return new Set()
  }

  // ppid -> [child pids]
  const childrenByParent = new Map<number, number[]>()
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s*$/)
    if (!m) continue
    const pid = Number(m[1])
    const ppid = Number(m[2])
    const existing = childrenByParent.get(ppid)
    if (existing) existing.push(pid)
    else childrenByParent.set(ppid, [pid])
  }

  const descendants = new Set<number>()
  const queue = [rootPid]
  while (queue.length > 0) {
    const cur = queue.shift() as number
    for (const child of childrenByParent.get(cur) ?? []) {
      // pid > 1 guards init; skip the root itself and already-seen pids.
      if (child > 1 && child !== rootPid && !descendants.has(child)) {
        descendants.add(child)
        queue.push(child)
      }
    }
  }
  return descendants
}

async function killProcessTreeUnix(pid: number, signal: string): Promise<void> {
  // Collect descendants BEFORE killing — once the group dies, the ps table
  // no longer shows the children, so escaped (re-parented) processes could
  // not be reaped afterwards.
  const descendants = await collectDescendantPids(pid)

  // 1. Group kill — the child was spawned `detached: true` (bashProvider),
  //    so it leads its own process group; `kill(-pid)` reaps the whole group
  //    atomically in one syscall. This handles the overwhelming majority.
  try {
    process.kill(-pid, signal)
  } catch (err) {
    // Fall back to killing the leader directly, then report unless the
    // process was already gone (ESRCH is expected on a normal exit race).
    try {
      process.kill(pid, signal)
    } catch {
      // leader already gone
    }
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
      logKillFailure('group_kill', err)
    }
  }

  // 2. Mop up any descendants that escaped the group (e.g. double-forked
  //    daemons that called setsid). Best-effort; missing pids are fine.
  for (const child of descendants) {
    try {
      process.kill(child, signal)
    } catch {
      // already gone
    }
  }
}

/**
 * Port of ant v2.1.150 `krK`/`XOO` (4974.js) — robustly kill a process and
 * its entire subtree.
 *
 * On Unix this uses process-group kill (`process.kill(-pid)`) as the primary
 * mechanism — atomic, single syscall, and correct because ccb spawns bash
 * `detached: true` so the child is its own group leader — with a `ps`-derived
 * descendant sweep as a fallback for re-parented escapees. On Windows there
 * is no process group; we recurse `getChildPids` and signal each pid.
 *
 * Fire-and-forget: ant's `krK` swallows the async rejection. Callers that
 * were using `tree-kill(pid, 'SIGKILL')` can switch to this for the group-kill
 * fast path and failure telemetry.
 */
export function killProcessTree(
  pid: number,
  signal: NodeJS.Signals | string = 'SIGKILL',
): void {
  // PID <= 1 guards current-group (0) and init (1).
  if (!Number.isInteger(pid) || pid <= 1) return

  if (process.platform === 'win32') {
    // No process groups on Windows: walk children depth-first and signal
    // each. getChildPids is synchronous (pgrep/CIM), so recurse inline.
    const killRec = (p: number): void => {
      for (const child of getChildPids(p)) {
        if (child > 1 && child !== p) killRec(child)
      }
      try {
        process.kill(p, signal)
      } catch {
        // already gone
      }
    }
    try {
      killRec(pid)
    } catch (err) {
      logKillFailure('win_tree', err)
    }
    return
  }

  void killProcessTreeUnix(pid, signal).catch(() => {})
}
