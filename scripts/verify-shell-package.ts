import { exec } from '../src/utils/Shell.js'

// Install minimal host bindings so exec() doesn't throw. The verifier runs
// outside the full app bootstrap.
try {
  const { installPermissionHostBindings } = await import('@claude-code/permission')
  installPermissionHostBindings({ getPlatform: () => process.platform === 'darwin' ? 'macos' : 'linux' } as any)
} catch { /* already installed */ }
try {
  const { installConfigHostBindings } = await import('@claude-code/config')
  installConfigHostBindings({} as any)
} catch { /* already installed */ }

async function runBashSmoke(): Promise<void> {
  const command = await exec(
    "printf 'phase4-shell-bash-ok'",
    AbortSignal.timeout(5_000),
    'bash',
  )
  const result = await command.result
  if (result.stdout.trim() !== 'phase4-shell-bash-ok') {
    throw new Error(`Unexpected bash output: ${JSON.stringify(result)}`)
  }
}

async function runPowerShellSmokeIfAvailable(): Promise<void> {
  const whichResult = Bun.spawnSync(['zsh', '-lc', 'command -v pwsh >/dev/null 2>&1'])
  if (whichResult.exitCode !== 0) {
    console.log('powershell smoke skipped: pwsh not available')
    return
  }

  const command = await exec(
    "Write-Output 'phase4-shell-powershell-ok'",
    AbortSignal.timeout(10_000),
    'powershell',
  )
  const result = await command.result
  if (!result.stdout.includes('phase4-shell-powershell-ok')) {
    throw new Error(`Unexpected PowerShell output: ${JSON.stringify(result)}`)
  }
}

await runBashSmoke()
await runPowerShellSmokeIfAvailable()
console.log('shell package verification passed')
