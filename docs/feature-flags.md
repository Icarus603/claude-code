# Feature flag registry

All `feature('<NAME>')` gates used by the codebase. The `feature()` function
is provided by `bun:bundle` (see `packages/cli/src/types/internal-modules.d.ts`); at build
time the feature flag is statically resolved if listed in
`scripts/default-features.ts:STABLE_FEATURES`, otherwise it stays
runtime-configurable via `FEATURE_<NAME>=1` env vars.

**Single source of truth**: `scripts/default-features.ts:STABLE_FEATURES`.
Both `scripts/dev.ts` (dev mode) and `build.ts` (release builds) import
from there. To make a flag default-on, add it to that array.

**At runtime**, `FEATURE_<NAME>=1` enables a flag for a single dev / build
invocation. Use this for flags that aren't yet stable enough to ship by
default but you want to exercise locally.

## On by default (32)

These are the production-ready features baked into every release binary
and `bun run dev` invocation.

| Flag | Subsystem | Status |
|------|-----------|--------|
| `AGENT_TRIGGERS_REMOTE` | Agent | Remote-controlled agent trigger dispatch (Bridge) |
| `AGENT_TRIGGERS` | Agent | Local agent trigger dispatch |
| `AWAY_SUMMARY` | Agent | Resume-friendly summary when returning to a paused session |
| `BREAK_CACHE_COMMAND` | Agent | `/break-cache` slash command for prompt-cache invalidation |
| `BRIDGE_MODE` | Bridge | Remote control / cloud-orchestrated session API |
| `BUILTIN_EXPLORE_PLAN_AGENTS` | Agent | Built-in `explore` and `plan` subagents |
| `CACHED_MICROCOMPACT` | Compaction | Reuse compaction results across resume |
| `CHICAGO_MCP` | Computer Use | macOS/Win Computer Use MCP server (screenshots, kbd, mouse) |
| `COORDINATOR_MODE` | Bridge | Multi-instance coordinator role |
| `DAEMON` | Daemon | Long-running supervisor process |
| `DUMP_SYSTEM_PROMPT` | Diagnostics | `--dump-system-prompt` CLI fast path |
| `EXTRACT_MEMORIES` | Memory | Auto-extract reusable facts to `memory/` |
| `FILE_PERSISTENCE` | Storage | Auto-save edited content alongside the source |
| `HISTORY_PICKER` | REPL UI | History `↑` shows the multi-message picker UI |
| `KAIROS_BRIEF` | Kairos | Brief mode (curated short responses for assistant) |
| `LODESTONE` | Agent | Long-horizon goal tracking |
| `MCP_RICH_OUTPUT` | MCP | Richer rendering of MCP tool results |
| `MCP_SKILLS` | MCP | Skills surfaced via MCP servers |
| `MESSAGE_ACTIONS` | REPL UI | Inline actions on past messages |
| `NATIVE_CLIPBOARD_IMAGE` | Computer Use | Paste images via native clipboard NAPI |
| `PROMPT_CACHE_BREAK_DETECTION` | Provider | Detect when prompt-cache will miss |
| `QUICK_SEARCH` | Tools | Fast `/` quicker search across session |
| `REACTIVE_COMPACT` | Compaction | Compaction triggered when context fills, not pre-emptively |
| `SHOT_STATS` | Diagnostics | Per-turn timing / token telemetry |
| `TEMPLATES` | Agent | Slash-command templates |
| `TOKEN_BUDGET` | Compaction | Budget-aware token allocation per turn |
| `TRANSCRIPT_CLASSIFIER` | Compaction | Classify transcript turns for retention scoring |
| `ULTRAPLAN` | Agent | Multi-step plan-then-execute mode |
| `ULTRATHINK` | Agent | Extended-thinking turn budget bump |
| `VERIFICATION_AGENT` | Agent | Spawn `verification` subagent after non-trivial work |
| `VOICE_MODE` | Voice | Push-to-talk speech-to-text input |
| `AUTO_THEME` | UI | Detect terminal background color and pick theme ('auto' option in /theme) |

## Available, off by default (51)

These exist as `feature('<NAME>')` gates but aren't in the stable list.
Enable per-run with `FEATURE_<NAME>=1`.

### Agent / Compaction
- `ABLATION_BASELINE` — A/B-test baseline (no-op model variant for measurement)
- `AGENT_MEMORY_SNAPSHOT` — Snapshot agent state for time-travel debugging
- `COMPACTION_REMINDERS` — Inject compaction-aware reminders during turns
- `CONTEXT_COLLAPSE` — Aggressive context summarization
- `FORK_SUBAGENT` — `/fork <directive>` slash command + Agent-tool fork path. Inherits parent conversation as `forkContextMessages`; runs fire-and-forget via `runAsyncAgentLifecycle` so the parent REPL keeps accepting input. Recursion guard via `isInForkChild`. Excluded under coordinator mode and `-p` non-interactive sessions (see `isForkSubagentEnabled`). **Default OFF** — mirrors ant's `tengu_copper_fox` GrowthBook gate (default false in ant v2.1.150 `VP5`). With fork OFF the Agent tool runs subagents in the FOREGROUND (spinner shows, `ctrl+b` to background); with it ON every spawn is forced async (instant-background, unified `<task-notification>` model). Opt in via `FEATURE_FORK_SUBAGENT=1` or `CLAUDE_CODE_FORK_SUBAGENT=1` (the env mirrors ant's env arm).
- `HARD_FAIL` — Crash on first uncaught error (vs swallow + log)
- `HISTORY_SNIP` — Trim history mid-session
- `HOOK_PROMPTS` — Inject prompt fragments via hooks
- `MEMORY_SHAPE_TELEMETRY` — Telemetry on memory record shape distribution
- `MONITOR_TOOL` — Background monitor tool for long-running operations
- `OVERFLOW_TEST_TOOL` — Synthetic tool for context-overflow testing
- `REVIEW_ARTIFACT` — Generate review artifacts for code review
- `RUN_SKILL_GENERATOR` — Auto-generate skill markdown from session
- `SKILL_IMPROVEMENT` — Auto-suggest skill improvements
- `STREAMLINED_OUTPUT` — Tighter user-facing output formatting
- `TEAMMEM` — Team memory sync (multi-user shared memory)
- `UNATTENDED_RETRY` — Auto-retry on transient errors without user prompt

### Bridge / Daemon / Server
- `BG_SESSIONS` — OS-level background sessions: `ccb --bg "<directive>"` spawns a detached `-p` child that survives terminal close, plus `ccb ps`/`logs`/`stop`/`kill`/`attach`/`rm`/`respawn` verbs operating on `~/.claude/jobs/<short>/`. Daemon-less Phase B implementation; daemon-managed PTY-attach is Phase C (deferred).
- `CCR_AUTO_CONNECT` — Auto-connect to Claude Code Remote on startup
- `CCR_MIRROR` — Mirror sessions to CCR for review
- `CCR_REMOTE_SETUP` — Remote setup wizard for CCR
- `CONNECTOR_TEXT` — Text-mode connector (stdin/stdout transport)
- `DIRECT_CONNECT` — Direct (non-Bridge) point-to-point session
- `KAIROS_CHANNELS` — Channel-based message dispatch in Kairos
- `KAIROS_GITHUB_WEBHOOKS` — GitHub webhook → Kairos channel routing
- `KAIROS_PUSH_NOTIFICATION` — Push-notify on Kairos events
- `KAIROS` — Kairos assistant base mode
- `PROACTIVE` — Proactive autonomous turns (no user prompt)
- `SELF_HOSTED_RUNNER` — Self-hosted runner profile
- `SSH_REMOTE` — SSH-tunneled remote sessions
- `UDS_INBOX` — Unix Domain Socket inbox for IPC

### Provider / Tools
- `BASH_CLASSIFIER` — Classify bash commands for permission tier
- `BUILDING_CLAUDE_APPS` — App-builder mode (scaffolding flows)
- `BYOC_ENVIRONMENT_RUNNER` — Bring-your-own-cloud env runner
- `EXPERIMENTAL_SKILL_SEARCH` — Vector-based skill discovery
- `NATIVE_CLIENT_ATTESTATION` — Native binary signature attestation
- `NEW_INIT` — Reworked `/init` flow
- `PERFETTO_TRACING` — Emit Perfetto traces for profiling
- `POWERSHELL_AUTO_MODE` — PowerShell automation mode (Win)
- `SLOW_OPERATION_LOGGING` — Verbose logs for ops > N ms
- `TERMINAL_PANEL` — Embedded terminal panel UI
- `TREE_SITTER_BASH_SHADOW` — Shadow-test tree-sitter against legacy
- `TREE_SITTER_BASH` — Tree-sitter-based bash parser
- `WEB_BROWSER_TOOL` — Persistent browser tool (vs ChromeMCP)

### Settings / Updates
- `ALLOW_TEST_VERSIONS` — Allow installing pre-release versions
- `COMMIT_ATTRIBUTION` — Add Co-Authored-By to git commits
- `DOWNLOAD_USER_SETTINGS` — Cloud-sync settings (download)
- `SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED` — Skip update probe when disabled
- `UPLOAD_USER_SETTINGS` — Cloud-sync settings (upload)

## Compile-time platform detect (2)

These resolve at native-build time only (set by the build system based on
the target binary's libc, not the runtime). Always false in JS dev / Node:

- `IS_LIBC_GLIBC` — true on glibc-Linux native builds
- `IS_LIBC_MUSL` — true on musl-Linux native builds

## Runtime env gates (not build flags)

Some subsystems are gated at **runtime** by an environment variable rather
than a build-time `feature()` flag, so the code ships in every binary and the
operator toggles it live. These are NOT in `STABLE_FEATURES` and cannot be
dead-code-eliminated.

- `CLAUDE_CODE_WORKFLOWS` — the Workflow subsystem (Workflow tool, `ultrawork`
  keyword rainbow-highlight + steer, `/workflows` history browser). Mirrors
  ant's `bp()` gate (ant: env opt-IN + `tengu_workflows_enabled`). ccb defaults
  **ON** (solo-operator, same rationale as `/goal`); set
  `CLAUDE_CODE_WORKFLOWS=0` to disable. Also folds in the `/goal` kill-switch
  (`CLAUDE_CODE_DISABLE_GOAL`). Predicate: `isWorkflowsEnabled()` in
  `packages/agent/goalStopHook.ts`. (Replaced the former build flags
  `ULTRAWORK` + `WORKFLOW_SCRIPTS`, which mis-ported a single runtime gate as
  two default-off build flags — stripping the whole subsystem from every
  shipped binary.)

## How to add a flag

1. Use it in code: `if (feature('MY_FLAG')) { ... }`
2. If you want it on by default, add `'MY_FLAG'` to
   `scripts/default-features.ts:STABLE_FEATURES`.
3. Otherwise leave it gated; users opt in with `FEATURE_MY_FLAG=1`.
4. Add a row to this file under the appropriate section.

## How to remove a dead flag

1. Find call sites: `rg "feature\('FLAG_NAME'\)"`
2. If 0 callers: just remove from `STABLE_FEATURES` (if listed) and
   delete this doc row.
3. If 1+ callers: replace `feature('X')` with the constant value the
   call site should use, then delete those branches.

## See also

- `scripts/default-features.ts` — STABLE_FEATURES list
- `scripts/audit-silent-failures/08-always-false-feature-flags.ts` —
  Detects flags that are gated but never enabled in any default config
  (helps spot dead branches)
- `packages/cli/src/types/internal-modules.d.ts` — Declaration of `feature()` from `bun:bundle`
