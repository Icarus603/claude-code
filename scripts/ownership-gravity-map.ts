/**
 * ownership-gravity-map.ts — authoritative subsystem → src/ mirror table.
 *
 * Derived from V7 §8 (subsystem Owns clauses), §10.1 (main.tsx landing),
 * §10.2 (print.ts landing), §10.3 (other root modules), and §8.24
 * (src/components/ decomposition rule).
 *
 * Each entry pairs an owner package with the root `src/*` paths that V7
 * designates as its eventual source of truth. `verify-ownership-gravity.ts`
 * measures owner_lines vs mirror_lines and fails when the ratio falls below
 * the wave-gated threshold or when the owner is an empty shell.
 *
 * Path discipline:
 *   - Paths are disjoint across entries (no file counted twice); if a dir
 *     has mixed ownership we split at subdirectory level.
 *   - A path is listed under the subsystem that V7 §8/§10 designates as
 *     its *final* owner — not its current location.
 *   - `src/utils/*` is intentionally not assigned to one owner; it will
 *     bleed into multiple. We only list utility subtrees that V7 §8 Owns
 *     clauses claim unambiguously (e.g. shell execution helpers → shell).
 *
 * When a V7 section moves a module's final owner, update this file in the
 * same commit. If a new package is added to V7 §8, add its entry here.
 */

export type SubsystemMirror = {
  /** V7 §8 subsystem name, matches doctor-architecture.ts layer map */
  subsystem: string
  /** package owner path (relative to repo root) */
  ownerPackage: string
  /** root `src/*` paths that should eventually drain into ownerPackage */
  srcMirrors: string[]
  /** V7 §10.4 wave number — drives the gravity threshold */
  wave: number
  /** optional override if the wave default is too strict/loose for this subsystem */
  threshold?: number
  /** V7 section(s) that authorize this mapping */
  v7Ref: string
  /** short note explaining non-obvious path choices */
  note?: string
}

export const SUBSYSTEM_MIRRORS: SubsystemMirror[] = [
  // ── Wave 1 — Leaves ──────────────────────────────────────────────────
  {
    subsystem: 'local-observability',
    ownerPackage: 'packages/local-observability',
    srcMirrors: [
      'src/services/internalLogging.ts',
      'src/utils/telemetry',
      'src/utils/log.ts',
      'src/utils/diagLogs.ts',
      'src/utils/errorLogSink.ts',
      'src/utils/telemetryAttributes.ts',
      'src/utils/unaryLogging.ts',
    ],
    wave: 1,
    v7Ref: '§8.12 / §10.3',
    note:
      'Includes telemetry dir (sessionTracing, perfettoTracing, etc. per §10.3). ' +
      'Excludes src/services/diagnosticTracking.ts (LSP diagnostics — belongs ' +
      'to `ide` subsystem per V7 §8.15 once that package is activated).',
  },
  {
    subsystem: 'config',
    ownerPackage: 'packages/config',
    srcMirrors: [
      'src/utils/settings',
      'src/utils/plugins',
      'src/services/plugins',
      'src/services/remoteManagedSettings',
      'src/services/settingsSync',
      'src/plugins',
      'src/types/plugin.ts',
      'src/utils/managedEnv.ts',
      'src/utils/managedEnvConstants.ts',
      'src/utils/env.ts',
      'src/utils/envUtils.ts',
      'src/utils/envDynamic.ts',
      'src/utils/envValidation.ts',
      'src/utils/gitSettings.ts',
      'src/services/privacyConfig.ts',
      'src/commands/plugin',
      'src/commands/config',
      'src/commands/env',
    ],
    wave: 1,
    v7Ref: '§8.6 / §10.1 plugin→config/plugin',
    note:
      'Plugin subsystem (src/utils/plugins, src/services/plugins, src/plugins) ' +
      'added to mirror in Round 4. src/commands/plugin UI stays as Wave-6 REPL.',
  },

  // ── Wave 2 — Platform Foundations ────────────────────────────────────
  {
    subsystem: 'permission',
    ownerPackage: 'packages/permission',
    srcMirrors: [
      '@claude-code/repl/components/permissions',
      'src/utils/permissions',
      'src/commands/permissions',
      'src/commands/auto-mode',
      '@claude-code/repl/hooks/toolPermission',
      '@claude-code/repl/hooks/useCanUseTool.tsx',
    ],
    wave: 2,
    v7Ref: '§8.4 / §8.24 / §10.1 auto-mode→permission/cli',
    note: 'Permission dialog UI归 permission per §8.24, not repl.',
  },
  {
    subsystem: 'memory',
    ownerPackage: 'packages/memory',
    srcMirrors: [
      'src/services/extractMemories',
      'src/services/SessionMemory',
      'src/services/teamMemorySync',
      'src/utils/memory',
      'src/utils/claudemd.ts',
      'src/utils/teamMemoryOps.ts',
      'src/utils/memoryFileDetection.ts',
      'src/commands/memory',
    ],
    wave: 2,
    v7Ref: '§8.5',
  },
  {
    subsystem: 'storage',
    ownerPackage: 'packages/storage',
    srcMirrors: [
      'src/services/sessionTranscript',
      'src/utils/sessionStorage.ts',
      'src/utils/sessionStoragePortable.ts',
      'src/utils/sessionStart.ts',
      'src/utils/sessionState.ts',
      'src/utils/sessionRestore.ts',
      'src/utils/sessionActivity.ts',
      'src/utils/sessionTitle.ts',
      'src/utils/sessionUrl.ts',
      'src/utils/secureStorage',
      'src/utils/toolResultStorage.ts',
      'src/utils/listSessionsImpl.ts',
      'src/utils/concurrentSessions.ts',
      'src/utils/sessionDataUploader.ts',
      'src/utils/cachePaths.ts',
      'src/utils/transcriptSearch.ts',
      'src/utils/agenticSessionSearch.ts',
    ],
    wave: 2,
    v7Ref: '§8.10 / §10.2 transcript/session-metadata stores',
  },
  {
    subsystem: 'output',
    ownerPackage: 'packages/output',
    srcMirrors: [
      'src/utils/format.ts',
      'src/utils/formatBriefTimestamp.ts',
      'src/utils/staticRender.tsx',
      'src/utils/exportRenderer.tsx',
      'src/utils/renderOptions.ts',
      'src/utils/ansiToPng.ts',
      'src/utils/ansiToSvg.ts',
      'src/utils/asciicast.ts',
      'src/utils/bufferedWriter.ts',
      'src/utils/CircularBuffer.ts',
    ],
    wave: 2,
    v7Ref: '§8.11',
    note: 'OutputTarget primitives: buffering, ANSI encoding, JSON formatters.',
  },
  {
    subsystem: 'shell',
    ownerPackage: 'packages/shell',
    srcMirrors: [
      'src/utils/Shell.ts',
      'src/utils/ShellCommand.ts',
      'src/utils/shell',
      'src/utils/shellConfig.ts',
      'src/utils/bash',
      'src/utils/powershell',
      'src/utils/execFileNoThrow.ts',
      'src/utils/execFileNoThrowPortable.ts',
      'src/utils/execSyncWrapper.ts',
      'src/utils/findExecutable.ts',
      'src/utils/immediateCommand.ts',
      'src/utils/commandLifecycle.ts',
      'src/utils/subprocessEnv.ts',
      'src/utils/promptShellExecution.ts',
      'src/utils/collapseBackgroundBashNotifications.ts',
    ],
    wave: 2,
    v7Ref: '§8.9',
    note: 'BashTool/PowerShellTool are tool-registry, not shell (§8.9 Must Not Depend On).',
  },

  // ── Wave 3 — Domain Core ──────────────────────────────────────────────
  {
    subsystem: 'provider',
    ownerPackage: 'packages/provider',
    srcMirrors: [
      'src/services/api',
      'src/services/oauth',
      'src/context.ts',
      'src/services/claudeAiLimits.ts',
      'src/services/claudeAiLimitsHook.ts',
      'src/services/rateLimitMessages.ts',
      'src/services/rateLimitMocking.ts',
      'src/services/mockRateLimits.ts',
      'src/services/policyLimits',
      'src/commands/provider.ts',
      'src/commands/login',
      'src/commands/logout',
      'src/commands/oauth-refresh',
      'src/commands/model',
    ],
    wave: 3,
    v7Ref: '§8.3 / §10.1 system-prompt→provider/context, auth→provider/auth/cli / §10.3',
    note: 'context.ts is provider-owned per §10.1 system-prompt→provider/context.',
  },
  {
    subsystem: 'tool-registry',
    ownerPackage: 'packages/tool-registry',
    srcMirrors: [
      'src/tools',
      'src/Tool.ts',
    ],
    wave: 3,
    v7Ref: '§8.7 / §10.3',
    note: '55 tool dirs. Tool render components go here per §8.24 (not repl).',
  },
  {
    subsystem: 'command-runtime',
    ownerPackage: 'packages/command-runtime',
    srcMirrors: [
      'src/utils/slashCommandParsing.ts',
      'src/utils/argumentSubstitution.ts',
      'src/utils/exampleCommands.ts',
      'src/skills',
    ],
    wave: 3,
    v7Ref: '§8.8',
    note: 'Individual src/commands/* go to their integration owner per §10.1; command-runtime owns the REGISTRY abstraction + skill loader.',
  },

  // ── Wave 4 — Agent Hub ────────────────────────────────────────────────
  {
    subsystem: 'agent',
    ownerPackage: 'packages/agent',
    srcMirrors: [
      'src/agent',
      'src/services/compact',
      'src/services/contextCollapse',
      'src/services/agentHostBindings.ts',
      'src/services/AgentSummary',
      'src/services/awaySummary.ts',
      'src/services/toolUseSummary',
      'src/tasks',
      'src/commands/compact',
      'src/commands/resume',
      'src/commands/fork',
      'src/commands/tasks',
      'src/utils/attribution.ts',
      'src/utils/attributionHooks.ts',
      'src/utils/attributionTrailer.ts',
      'src/utils/abortController.ts',
    ],
    wave: 4,
    v7Ref: '§8.2 / §10.1 .command(task)→agent/cli/tasks / §10.3',
    note: 'src/agent/*DepImpl dissolve per §10.3 (createDeps→app-host+agent/compat); compaction+attribution+abort lifecycle are agent-owned.',
  },

  // ── Wave 5 — Integrations ─────────────────────────────────────────────
  {
    subsystem: 'mcp',
    ownerPackage: 'packages/mcp-runtime',
    srcMirrors: [
      'src/services/mcp',
      'src/utils/mcp',
      'src/utils/mcpInstructionsDelta.ts',
      'src/utils/mcpValidation.ts',
      'src/utils/mcpWebSocketTransport.ts',
      'src/utils/mcpOutputStorage.ts',
      'src/services/mcpServerApproval.tsx',
      'src/commands/mcp',
      'src/entrypoints/mcp.ts',
    ],
    wave: 5,
    v7Ref: '§8.13 / §10.1 mcp→mcp/cli / §10.2 handleMcpSetServers→mcp/config',
  },
  {
    subsystem: 'swarm',
    ownerPackage: 'packages/swarm',
    srcMirrors: [
      'src/commands/agents',
      'src/commands/agents-platform',
      'src/commands/peers',
      'src/commands/branch',
      'src/utils/agentSwarmsEnabled.ts',
    ],
    wave: 5,
    v7Ref: '§8.14 / §10.1 .command(agents)→swarm/cli',
    note: 'Worktree/tmux/teammate runtime already largely in packages/swarm; remaining CLI surface in src/commands.',
  },
  {
    subsystem: 'voice',
    ownerPackage: 'packages/voice',
    srcMirrors: [
      'src/voice',
      '@claude-code/repl/hooks/useVoice.ts',
      '@claude-code/repl/hooks/useVoiceEnabled.ts',
      '@claude-code/repl/hooks/useVoiceIntegration.tsx',
      'src/services/voice.ts',
      'src/services/voiceStreamSTT.ts',
      'src/services/voiceKeyterms.ts',
      'src/commands/voice',
    ],
    wave: 5,
    v7Ref: '§8.20 / §10.3',
  },
  {
    subsystem: 'bridge',
    ownerPackage: 'packages/bridge',
    srcMirrors: [
      'src/bridge',
      'src/commands/bridge',
      'src/commands/bridge-kick.ts',
      'src/commands/remoteControlServer',
      'src/commands/remote-env',
    ],
    wave: 5,
    v7Ref: '§8.21 / §10.1 remote-control→bridge/cli / §10.3',
  },
  {
    subsystem: 'daemon',
    ownerPackage: 'packages/daemon',
    srcMirrors: [
      'src/daemon',
    ],
    wave: 5,
    v7Ref: '§8.22 / §10.3',
  },
  {
    subsystem: 'ide',
    ownerPackage: 'packages/ide',
    srcMirrors: [
      'src/services/lsp',
      '@claude-code/repl/hooks/useIDEIntegration.tsx',
      '@claude-code/repl/hooks/useIdeAtMentioned.ts',
      '@claude-code/repl/hooks/useIdeConnectionStatus.ts',
      '@claude-code/repl/hooks/useIdeLogging.ts',
      '@claude-code/repl/hooks/useIdeSelection.ts',
      '@claude-code/repl/hooks/useDiffInIDE.ts',
      'src/commands/ide',
    ],
    wave: 5,
    v7Ref: '§8.15',
    note: 'V7 §15 deferred — kept here so new IDE logic does not leak into src/.',
  },
  {
    subsystem: 'teleport',
    ownerPackage: 'packages/teleport',
    srcMirrors: [
      'src/commands/teleport',
      'src/commands/remote-setup',
    ],
    wave: 5,
    v7Ref: '§8.16 / §10.1 ssh→teleport/cli',
  },
  {
    subsystem: 'updater',
    ownerPackage: 'packages/updater',
    srcMirrors: [
      'src/utils/autoUpdater.ts',
      'src/utils/binaryCheck.ts',
      'src/commands/upgrade',
      'src/cli/update.ts',
      'src/cli/up.ts',
      'src/cli/rollback.ts',
    ],
    wave: 5,
    v7Ref: '§8.17 / §10.1 up/rollback/install→updater/cli',
  },
  {
    subsystem: 'server',
    ownerPackage: 'packages/server',
    srcMirrors: [
      'src/remote',
    ],
    wave: 5,
    v7Ref: '§8.18 / §10.3 RemoteSessionManager→server/session',
  },

  // ── Wave 6 — App Hosts ────────────────────────────────────────────────
  {
    subsystem: 'app-host',
    ownerPackage: 'packages/app-host',
    srcMirrors: [
      'src/bootstrap',
      'src/main',
      'src/runtime',
      'src/services/packageHostSetup.ts',
      'src/services/api/providerHostSetup.ts',
      'src/entrypoints/init.ts',
    ],
    wave: 6,
    v7Ref: '§8.1 / §10.1 startup+pre-action+mode-dispatch / §10.3',
    note: 'app-host is composition root; owns bootstrap, mode dispatch, host bindings install.',
  },
  {
    subsystem: 'cli',
    ownerPackage: 'packages/cli',
    srcMirrors: [
      'src/cli/structuredIO.ts',
      'src/cli/remoteIO.ts',
      'src/cli/ndjsonSafeStringify.ts',
      'src/cli/transports',
      'src/cli/handlers',
      'src/cli/bg.ts',
      'src/cli/mcpServersHandlers.ts',
      'src/entrypoints/cli.tsx',
    ],
    wave: 6,
    v7Ref: '§8.23 / §10.1 commander / §10.2 structured-io',
    note: 'src/main.tsx, src/cli/print.ts are already facades — not counted.',
  },
  {
    subsystem: 'repl',
    ownerPackage: 'packages/repl',
    srcMirrors: [
      'src/screens',
      'src/components',
      'src/hooks',
      'src/keybindings',
    ],
    wave: 6,
    // REPL will never reach 0.9 gravity — too many UI hooks are host-local.
    // 0.7 is the realistic target once §8.24 decomposition + permission/tool-
    // registry render split completes.
    threshold: 0.7,
    v7Ref: '§8.24 / §10.3 REPL.tsx already facade',
    note: 'Threshold lowered to 0.7 because permission+tool render subtrees belong to other owners per §8.24 (they are listed in their own entries and double-counting is disallowed — this entry covers repl-owned remainder only).',
  },
  {
    subsystem: 'headless-sdk',
    ownerPackage: 'packages/headless-sdk',
    srcMirrors: [

      // src/entrypoints/* SDK shims removed — canonical owners are in packages/headless-sdk/
    ],
    wave: 6,
    v7Ref: '§8.25 / §10.2 runHeadless / §10.3 sdkMessageAdapter',
    note: 'Most print.ts content has already drained into packages/cli; this entry covers the residual SDK-facing surface.',
  },
]
