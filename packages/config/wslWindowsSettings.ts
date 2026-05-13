/**
 * WSL → Windows managed-settings reader.
 *
 * Port of ant v2.1.136 (0684.js `gI6` / 0683.js `xSH` / 0661.js `JB`).
 * The infrastructure to read the Windows policy chain from inside WSL
 * is fully implemented — registry queries via `/mnt/c/Windows/System32
 * /reg.exe`, file reads from `/mnt/c/Program Files/ClaudeCode/
 * managed-settings.json`, the dual flag check (admin source AND HKCU
 * user opt-in) — but ant `E6_()` is hardcoded to return `false` in
 * v2.1.136, which short-circuits the entire chain at the call site.
 *
 * Why ant disabled it: WSL's DrvFs-backed Windows reads are
 * unreliable across distro updates and Hyper-V states (file paths
 * disappear, reg.exe interop can hang). Until a more reliable
 * mechanism lands, the WSL chain is gated off. Settings authors
 * should rely on `/etc/claude-code/managed-settings.json` for WSL
 * deployments.
 *
 * ccb mirrors this byte-for-byte: `isWslChainEnabled()` matches ant
 * `E6_()` (hardcoded false), so `getWslInheritedWindowsSettings()`
 * returns null without spawning any subprocesses. The full
 * read-path is kept so that when ant flips the gate back on, ccb
 * picks up the change in one constant edit instead of a re-port.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const HKLM_KEY = 'HKLM\\SOFTWARE\\Policies\\ClaudeCode'
const HKCU_KEY = 'HKCU\\SOFTWARE\\Policies\\ClaudeCode'
const HKLM_MANAGED_SETTINGS_PATH =
  '/mnt/c/Program Files/ClaudeCode/managed-settings.json'

/**
 * Ant `E6_()` — currently hardcoded to false in v2.1.136. When ant
 * flips this back on, replace `WSL_CHAIN_ENABLED` with the live
 * check (likely `isRunningInWsl()` or a new feature gate). The rest
 * of this module is the implementation that becomes active.
 *
 * History: ant 2.1.131 had this returning `isRunningInWsl()`; in
 * 2.1.136 the function body became `return !1` (a hardcoded false).
 * The change disabled the WSL chain pending a more reliable
 * subprocess mechanism (the reg.exe queries and DrvFs reads were
 * timing out on Win11 24H2 / WSL2 with no consistent failure mode).
 */
const WSL_CHAIN_ENABLED = false

function isWslChainEnabled(): boolean {
  // ant E6_(): hardcoded false in v2.1.136. Keep the function shape
  // so future re-enablement is a constant edit and call sites stay
  // the same.
  return WSL_CHAIN_ENABLED
}

function isRunningInWsl(): boolean {
  if (process.env.WSL_DISTRO_NAME) return true
  try {
    const ver = readFileSync('/proc/version', 'utf-8').toLowerCase()
    return ver.includes('microsoft') || ver.includes('wsl')
  } catch {
    return false
  }
}

async function readRegKeyValue(
  key: string,
  valueName: string,
): Promise<string | undefined> {
  // Use cmd.exe via DrvFs interop. WSL ships /mnt/c/Windows/System32 by default.
  try {
    const { stdout } = await execFileAsync(
      '/mnt/c/Windows/System32/reg.exe',
      ['query', key, '/v', valueName],
      { timeout: 5000 },
    )
    // Format: "    valueName    REG_SZ    value"
    const match = new RegExp(
      `${valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+REG_[A-Z_]+\\s+(.+)`,
    ).exec(stdout)
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

async function readWslInheritsFlag(key: string): Promise<boolean> {
  const raw = await readRegKeyValue(key, 'wslInheritsWindowsSettings')
  if (!raw) return false
  return /^(1|true)$/i.test(raw)
}

/**
 * Returns the Windows policy chain settings to layer on top of Linux
 * managed-settings, or null when:
 *   - the WSL chain feature is disabled (ant E6_() === false)
 *   - not running in WSL
 *   - admin source's wslInheritsWindowsSettings is not true
 *   - HKCU's wslInheritsWindowsSettings is not true (user opt-in)
 *
 * The short-circuit on `isWslChainEnabled()` mirrors ant's
 * `if(!E6_()) return null;` guard at the top of every read site —
 * keeping the function callable but quickly disabled.
 */
export async function getWslInheritedWindowsSettings(): Promise<
  Record<string, unknown> | null
> {
  // Ant `E6_() => false` short-circuit. Keep the rest of the body
  // intact so the future flip is a one-line change.
  if (!isWslChainEnabled()) return null
  if (!isRunningInWsl()) return null
  // Admin source check: file OR HKLM must declare the flag.
  let fileSettings: Record<string, unknown> | undefined
  if (existsSync(HKLM_MANAGED_SETTINGS_PATH)) {
    try {
      const raw = readFileSync(HKLM_MANAGED_SETTINGS_PATH, 'utf-8')
      fileSettings = JSON.parse(raw) as Record<string, unknown>
    } catch {
      // malformed admin file — fall through to HKLM check
    }
  }
  const fileFlag =
    fileSettings &&
    (fileSettings as { wslInheritsWindowsSettings?: boolean })
      .wslInheritsWindowsSettings === true
  const hklmFlag = await readWslInheritsFlag(HKLM_KEY)
  if (!fileFlag && !hklmFlag) return null

  // User opt-in: HKCU must also have the flag.
  const hkcuFlag = await readWslInheritsFlag(HKCU_KEY)
  if (!hkcuFlag) return null

  // Strip `wslInheritsWindowsSettings` from the merged payload — the
  // flag is metadata about whether to apply the chain, not a setting
  // that should be propagated to the live managedSettings. Ant
  // `nAq` does the same destructure-strip.
  const merged: Record<string, unknown> = {}
  if (fileSettings) {
    const { wslInheritsWindowsSettings: _strip, ...rest } = fileSettings
    void _strip
    Object.assign(merged, rest)
  }
  return merged
}
