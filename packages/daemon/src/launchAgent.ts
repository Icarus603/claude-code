/**
 * macOS LaunchAgent control surface for the bg daemon.
 *
 * Ports ant 4135.js — installs `~/Library/LaunchAgents/com.ccb.daemon.plist`
 * and routes `daemon install/uninstall/start/stop/restart/status` through
 * `launchctl bootstrap/bootout/kickstart/kill/print`.
 *
 * Linux/Windows return ok=false with "not supported on platform". (ant
 * v2.1.131 also targets darwin only for the launch-agent path; a future
 * pass can add systemd unit-file support if needed.)
 *
 * @dynamicRequire
 */

import { homedir } from 'node:os'
import { mkdir, readFile, unlink, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const SERVICE_LABEL = 'com.ccb.daemon'

interface LaunchctlResult {
  code: number
  stdout: string
  stderr: string
  error?: string
}

interface InstallOpts {
  jsonPath: string
  logPath: string
}

interface ServiceResult {
  ok: boolean
  error?: string
  serviceId?: string
  servicePath?: string
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\r\n]/g, ' ')
}

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
}

function domainTarget(): string {
  return `gui/${process.getuid?.() ?? 0}`
}

function serviceTarget(): string {
  return `${domainTarget()}/${SERVICE_LABEL}`
}

function programPath(): string {
  // ccb runs from a single-file binary or `bun dist/cli.js`; we want the
  // program that re-invokes us. Mirrors ant MV8(): use process.argv[1]
  // when run via JIT, the bun-compile target otherwise.
  return process.argv[1] ?? process.execPath
}

async function runLaunchctl(args: readonly string[]): Promise<LaunchctlResult> {
  return new Promise(resolve => {
    const c = spawn('launchctl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    c.stdout.on('data', d => (stdout += d.toString('utf8')))
    c.stderr.on('data', d => (stderr += d.toString('utf8')))
    c.on('error', err =>
      resolve({ code: -1, stdout, stderr, error: err.message }),
    )
    c.on('close', code => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

export async function installLaunchAgent(opts: InstallOpts): Promise<ServiceResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'service install not supported on this platform' }
  }
  const path = plistPath()
  const program = programPath()
  const env = process.env.PATH || '/usr/local/bin:/usr/bin:/bin'
  try {
    await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
    await writeFile(
      path,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${escapeXml(program)}</string>
    <string>daemon</string>
    <string>bg</string>
    <string>run</string>
    <string>--json-path</string>
    <string>${escapeXml(opts.jsonPath)}</string>
    <string>--log-file</string>
    <string>${escapeXml(opts.logPath)}</string>
    <string>--origin</string>
    <string>service</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${escapeXml(env)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${escapeXml(opts.logPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(opts.logPath)}</string>
</dict></plist>
`,
      'utf8',
    )
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      serviceId: SERVICE_LABEL,
      servicePath: path,
    }
  }
  await runLaunchctl(['bootout', serviceTarget()])
  const r = await runLaunchctl(['bootstrap', domainTarget(), path])
  if (r.code !== 0) {
    return {
      ok: false,
      error: r.stderr || r.error || 'launchctl bootstrap failed',
      serviceId: SERVICE_LABEL,
      servicePath: path,
    }
  }
  return { ok: true, serviceId: SERVICE_LABEL, servicePath: path }
}

export async function uninstallLaunchAgent(): Promise<ServiceResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'service uninstall not supported on this platform' }
  }
  const path = plistPath()
  await runLaunchctl(['bootout', serviceTarget()])
  try {
    await unlink(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ok: false, error: (e as Error).message }
    }
  }
  return { ok: true }
}

async function launchAgentVerb(verb: 'start' | 'stop' | 'restart'): Promise<ServiceResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, error: `${verb} not supported on this platform` }
  }
  const target = serviceTarget()
  let args: string[]
  if (verb === 'start') args = ['kickstart', target]
  else if (verb === 'stop') args = ['kill', 'SIGTERM', target]
  else {
    await runLaunchctl(['kill', 'SIGTERM', target])
    let exited = false
    for (let i = 0; i < 200; i++) {
      const r = await runLaunchctl(['print', target])
      if (r.code !== 0 || !/^\s*pid = /m.test(r.stdout)) {
        exited = true
        break
      }
      await new Promise(res => setTimeout(res, 50))
    }
    if (!exited) {
      return {
        ok: false,
        error:
          'daemon did not exit within 10s of SIGTERM; restart aborted before kickstart',
      }
    }
    args = ['kickstart', target]
  }
  const r = await runLaunchctl(args)
  if (r.code !== 0) {
    if (verb === 'stop') return { ok: true }
    return {
      ok: false,
      error: r.stderr || r.error || `launchctl ${args[0]} failed`,
    }
  }
  return { ok: true }
}

export async function startLaunchAgent(): Promise<ServiceResult> {
  return launchAgentVerb('start')
}
export async function stopLaunchAgent(): Promise<ServiceResult> {
  return launchAgentVerb('stop')
}
export async function restartLaunchAgent(): Promise<ServiceResult> {
  return launchAgentVerb('restart')
}

/**
 * Returns true if installed plist points at a program path that no longer
 * exists on disk (ccb upgrade left the old binary path in plist).
 */
export async function isLaunchAgentStale(): Promise<boolean> {
  const path = plistPath()
  let xml: string
  try {
    xml = await readFile(path, 'utf8')
  } catch {
    return false
  }
  const m = xml.match(/<key>ProgramArguments<\/key><array>\s*<string>([^<]+)</)
  const program = m?.[1]
  if (!program) return false
  const decoded = program
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
  try {
    await access(decoded)
    return false
  } catch {
    return true
  }
}

export async function isLaunchAgentRunning(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  const r = await runLaunchctl(['print', serviceTarget()])
  return r.code === 0
}
