/**
 * Early argv preprocessing extracted from src/main.tsx per V7 §10.1.
 *
 * Handles the feature-gated URL / deep-link / KAIROS / SSH argv rewrites
 * that must run BEFORE commander parses argv. Each section stashes its
 * parsed state in a `pending*` handle which is later consumed by
 * `runModeDispatch` via the `ModeDispatchContext`.
 *
 * These blocks are intentionally separate from `runModeDispatch` because
 * they must mutate `process.argv` while commander is still unaware of the
 * subcommand tree.
 */

import { feature } from 'bun:bundle'
import { gracefulShutdownSync } from '../../../../src/utils/gracefulShutdown.js'
import type {
  PendingAssistantChat,
  PendingConnect,
  PendingSSH,
} from './mode-dispatch.js'

export type PendingHandles = {
  pendingConnect: PendingConnect | undefined
  pendingSSH: PendingSSH | undefined
  pendingAssistantChat: PendingAssistantChat | undefined
}

/**
 * Build the feature-gated pending-handle objects that `preprocessCliArgv`
 * populates and `runModeDispatch` later consumes.
 */
export function createPendingHandles(): PendingHandles {
  return {
    pendingConnect: feature('DIRECT_CONNECT')
      ? { url: undefined, authToken: undefined, dangerouslySkipPermissions: false }
      : undefined,
    pendingAssistantChat: feature('KAIROS')
      ? { sessionId: undefined, discover: false }
      : undefined,
    pendingSSH: feature('SSH_REMOTE')
      ? {
          host: undefined,
          cwd: undefined,
          permissionMode: undefined,
          dangerouslySkipPermissions: false,
          local: false,
          extraCliArgs: [],
        }
      : undefined,
  }
}

/**
 * Perform feature-gated argv rewrites:
 *   - cc:// / cc+unix:// URLs (DIRECT_CONNECT)
 *   - --handle-uri / macOS LaunchServices deep links (LODESTONE)
 *   - `claude assistant [sessionId]` (KAIROS)
 *   - `claude ssh <host> [dir]` (SSH_REMOTE)
 *
 * Mutates `process.argv` in place and populates `pendings` for later
 * consumption by `runModeDispatch`.
 */
export async function preprocessCliArgv(pendings: PendingHandles): Promise<void> {
  const { pendingConnect, pendingAssistantChat, pendingSSH } = pendings

  // Check for cc:// or cc+unix:// URL in argv — rewrite so the main command
  // handles it, giving the full interactive TUI instead of a stripped-down subcommand.
  // For headless (-p), we rewrite to the internal `open` subcommand.
  if (feature('DIRECT_CONNECT')) {
    const rawCliArgs = process.argv.slice(2)
    const ccIdx = rawCliArgs.findIndex(
      a => a.startsWith('cc://') || a.startsWith('cc+unix://'),
    )
    if (ccIdx !== -1 && pendingConnect) {
      const ccUrl = rawCliArgs[ccIdx]!
      const { parseConnectUrl } = await import(
        '../../../../src/server/parseConnectUrl.js'
      )
      const parsed = parseConnectUrl(ccUrl)
      pendingConnect.dangerouslySkipPermissions = rawCliArgs.includes(
        '--dangerously-skip-permissions',
      )

      if (rawCliArgs.includes('-p') || rawCliArgs.includes('--print')) {
        // Headless: rewrite to internal `open` subcommand
        const stripped = rawCliArgs.filter((_, i) => i !== ccIdx)
        const dspIdx = stripped.indexOf('--dangerously-skip-permissions')
        if (dspIdx !== -1) {
          stripped.splice(dspIdx, 1)
        }
        process.argv = [process.argv[0]!, process.argv[1]!, 'open', ccUrl, ...stripped]
      } else {
        // Interactive: strip cc:// URL and flags, run main command
        pendingConnect.url = parsed.serverUrl
        pendingConnect.authToken = parsed.authToken
        const stripped = rawCliArgs.filter((_, i) => i !== ccIdx)
        const dspIdx = stripped.indexOf('--dangerously-skip-permissions')
        if (dspIdx !== -1) {
          stripped.splice(dspIdx, 1)
        }
        process.argv = [process.argv[0]!, process.argv[1]!, ...stripped]
      }
    }
  }

  // Handle deep link URIs early — this is invoked by the OS protocol handler
  // and should bail out before full init since it only needs to parse the URI
  // and open a terminal.
  if (feature('LODESTONE')) {
    const handleUriIdx = process.argv.indexOf('--handle-uri')
    if (handleUriIdx !== -1 && process.argv[handleUriIdx + 1]) {
      const { enableConfigs } = await import('@claude-code/config')
      enableConfigs()
      const uri = process.argv[handleUriIdx + 1]!
      const { handleDeepLinkUri } = await import(
        '../../../../src/utils/deepLink/protocolHandler.js'
      )
      const exitCode = await handleDeepLinkUri(uri)
      process.exit(exitCode)
    }

    // macOS URL handler: when LaunchServices launches our .app bundle, the
    // URL arrives via Apple Event (not argv). LaunchServices overwrites
    // __CFBundleIdentifier to the launching bundle's ID, which is a precise
    // positive signal — cheaper than importing and guessing with heuristics.
    if (
      process.platform === 'darwin' &&
      process.env.__CFBundleIdentifier === 'com.anthropic.claude-code-url-handler'
    ) {
      const { enableConfigs } = await import('@claude-code/config')
      enableConfigs()
      const { handleUrlSchemeLaunch } = await import(
        '../../../../src/utils/deepLink/protocolHandler.js'
      )
      const urlSchemeResult = await handleUrlSchemeLaunch()
      process.exit(urlSchemeResult ?? 1)
    }
  }

  // `claude assistant [sessionId]` — stash and strip so the main
  // command handles it, giving the full interactive TUI. Position-0 only
  // (matching the ssh pattern below) — indexOf would false-positive on
  // `claude -p "explain assistant"`. Root-flag-before-subcommand
  // (e.g. `--debug assistant`) falls through to the stub, which
  // prints usage.
  if (feature('KAIROS') && pendingAssistantChat) {
    const rawArgs = process.argv.slice(2)
    if (rawArgs[0] === 'assistant') {
      const nextArg = rawArgs[1]
      if (nextArg && !nextArg.startsWith('-')) {
        pendingAssistantChat.sessionId = nextArg
        rawArgs.splice(0, 2) // drop 'assistant' and sessionId
        process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs]
      } else if (!nextArg) {
        pendingAssistantChat.discover = true
        rawArgs.splice(0, 1) // drop 'assistant'
        process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs]
      }
      // else: `claude assistant --help` → fall through to stub
    }
  }

  // `claude ssh <host> [dir]` — strip from argv so the main command handler
  // runs (full interactive TUI), stash the host/dir for the REPL branch at
  // to pick up. Headless (-p) mode not supported in v1: SSH sessions need
  // the local REPL to drive them (interrupt, permissions).
  if (feature('SSH_REMOTE') && pendingSSH) {
    const rawCliArgs = process.argv.slice(2)
    // SSH-specific flags can appear before the host positional (e.g.
    // `ssh --permission-mode auto host /tmp` — standard POSIX flags-before-
    // positionals). Pull them all out BEFORE checking whether a host was
    // given, so `claude ssh --permission-mode auto host` and `claude ssh host
    // --permission-mode auto` are equivalent. The host check below only needs
    // to guard against `-h`/`--help` (which commander should handle).
    if (rawCliArgs[0] === 'ssh') {
      const localIdx = rawCliArgs.indexOf('--local')
      if (localIdx !== -1) {
        pendingSSH.local = true
        rawCliArgs.splice(localIdx, 1)
      }
      const dspIdx = rawCliArgs.indexOf('--dangerously-skip-permissions')
      if (dspIdx !== -1) {
        pendingSSH.dangerouslySkipPermissions = true
        rawCliArgs.splice(dspIdx, 1)
      }
      const pmIdx = rawCliArgs.indexOf('--permission-mode')
      if (
        pmIdx !== -1 &&
        rawCliArgs[pmIdx + 1] &&
        !rawCliArgs[pmIdx + 1]!.startsWith('-')
      ) {
        pendingSSH.permissionMode = rawCliArgs[pmIdx + 1]
        rawCliArgs.splice(pmIdx, 2)
      }
      const pmEqIdx = rawCliArgs.findIndex(a => a.startsWith('--permission-mode='))
      if (pmEqIdx !== -1) {
        pendingSSH.permissionMode = rawCliArgs[pmEqIdx]!.split('=')[1]
        rawCliArgs.splice(pmEqIdx, 1)
      }
      // Forward session-resume + model flags to the remote CLI's initial spawn.
      // --continue/-c and --resume <uuid> operate on the REMOTE session history
      // (which persists under the remote's ~/.claude/projects/<cwd>/).
      // --model controls which model the remote uses.
      const extractFlag = (
        flag: string,
        opts: { hasValue?: boolean; as?: string } = {},
      ): void => {
        const i = rawCliArgs.indexOf(flag)
        if (i !== -1) {
          pendingSSH.extraCliArgs.push(opts.as ?? flag)
          const val = rawCliArgs[i + 1]
          if (opts.hasValue && val && !val.startsWith('-')) {
            pendingSSH.extraCliArgs.push(val)
            rawCliArgs.splice(i, 2)
          } else {
            rawCliArgs.splice(i, 1)
          }
        }
        const eqI = rawCliArgs.findIndex(a => a.startsWith(`${flag}=`))
        if (eqI !== -1) {
          pendingSSH.extraCliArgs.push(
            opts.as ?? flag,
            rawCliArgs[eqI]!.slice(flag.length + 1),
          )
          rawCliArgs.splice(eqI, 1)
        }
      }
      extractFlag('-c', { as: '--continue' })
      extractFlag('--continue')
      extractFlag('--resume', { hasValue: true })
      extractFlag('--model', { hasValue: true })
    }
    // After pre-extraction, any remaining dash-arg at [1] is either -h/--help
    // (commander handles) or an unknown-to-ssh flag (fall through to commander
    // so it surfaces a proper error). Only a non-dash arg is the host.
    if (
      rawCliArgs[0] === 'ssh' &&
      rawCliArgs[1] &&
      !rawCliArgs[1].startsWith('-')
    ) {
      pendingSSH.host = rawCliArgs[1]
      // Optional positional cwd.
      let consumed = 2
      if (rawCliArgs[2] && !rawCliArgs[2].startsWith('-')) {
        pendingSSH.cwd = rawCliArgs[2]
        consumed = 3
      }
      const rest = rawCliArgs.slice(consumed)

      // Headless (-p) mode is not supported with SSH in v1 — reject early
      // so the flag doesn't silently cause local execution.
      if (rest.includes('-p') || rest.includes('--print')) {
        process.stderr.write(
          'Error: headless (-p/--print) mode is not supported with claude ssh\n',
        )
        gracefulShutdownSync(1)
        return
      }

      // Rewrite argv so the main command sees remaining flags but not `ssh`.
      process.argv = [process.argv[0]!, process.argv[1]!, ...rest]
    }
  }
}
