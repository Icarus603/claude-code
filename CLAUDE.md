# CLAUDE.md

Guidance for Claude Code working in this repository.

## Project Overview

**ccb** — a personal, self-hosted Claude Code CLI, originating from the Anthropic npm sourcemap leak (v2.1.88, 2026-03-31) and subsequently reorganised into a packages-based monorepo. Single-user — no public API, no public npm package.

The repo is post-V7 refactor: monolithic `src/` is gone, all code lives in `packages/*` and `packages/@ant/*` workspaces. ~2317 unit tests + 20 smoke tests, 0 fail.

## Commands

```bash
bun install                  # install + wire git hooks
bun run dev                  # dev mode (MACRO defines + STABLE_FEATURES injected)
bun run dev:inspect          # dev mode w/ debugger (set BUN_INSPECT=9229)
bun run build                # release build → dist/cli.js (single file, target=bun)
bun run build:standalone     # standalone binary for current platform
bun run build:platforms      # cross-compile binaries for all platforms

bun test                     # all unit + integration tests
bun run smoke                # tests/smoke/ — runtime probe + plugin hooks
bun test <path>              # single file

bun run lint                 # biome lint .
bun run lint:fix             # biome lint --fix .
bun run format               # biome format --write .

bun run health               # one-shot: lint + tests + build + verifier subset
bun run doctor:arch          # full architecture verifier suite (60 rules)
bun run check:unused         # knip — find unused exports

bun run release v26.4.N      # tag + push; CI builds + publishes via release.yml
```

### `ccb` vs `ccbdev` vs `claude` — three CLIs, three roles

The user's `~/.local/bin/` contains three look-alike binaries. Knowing which
is which matters when debugging — testing the wrong one wastes a session.

| Command  | Symlink target                                  | Purpose                                                       |
|----------|-------------------------------------------------|---------------------------------------------------------------|
| `ccb`    | `~/.local/share/ccb/versions/<vX.Y.Z>` binary   | Released ccb — frozen at last `bun run release`. Auto-updates from GitHub Releases. **Stable** snapshot, no local edits visible. |
| `ccbdev` | `→ <repo>/dist/cli.js` (live symlink)           | Local-build ccb — runs whatever `bun run build` last produced. **Reflects every code change** the moment build finishes. |
| `claude` | Anthropic's official CLI (separate npm install) | Upstream Claude Code from Anthropic. Used as reference / sanity comparison; unrelated to this repo. |

**Verifying a code change**: always use `ccbdev` after `bun run build`. `ccb`
will show stale behaviour because it's pinned to the last released version.

**Restart matters**: `ccbdev` reads `dist/cli.js` at process start. A running
session keeps the OLD bytecode in memory — rebuild + restart, not just
rebuild. (The 2026-04-29 bash-mode-debugging session lost ~30min to a
stale ccbdev process making one fix look like it didn't take.)

**`which`/symlink check** (paste this if you forget):
```bash
ls -la ~/.local/bin/ccb ~/.local/bin/ccbdev ~/.local/bin/claude
```

## Architecture

### Runtime & Build

- **Runtime**: Bun ≥ 1.3 (not Node). `bun:bundle`, `bun:ffi`, `Bun.embeddedFiles`, `globalThis.Bun.$` are all in use.
- **Build**: `build.ts` calls `Bun.build({ target: 'bun', splitting: false })`. Entry: `packages/cli/src/entry/cli.tsx`. Output: single `dist/cli.js` (~13 MB). The artifact is **Bun-only** — `node dist/cli.js` will throw on the first `Bun.$` reference.
- **Defines**: `scripts/defines.ts` (centralized). `MACRO.VERSION` is derived from the latest reachable git tag — never hardcoded.
- **Module system**: ESM (`"type": "module"`), TSX with `react-jsx`.
- **Monorepo**: Bun workspaces — `packages/*` and `packages/@ant/*` resolved via `workspace:*`.
- **Lint/Format**: Biome 2.x (`biome.json`).
- **Distribution**: Standalone binaries via `bun build --compile`, installed to `~/.local/share/ccb/versions/<version>` and symlinked from `~/.local/bin/ccb`. Auto-update lives in the binary itself. Not on npm.

### Entry & Bootstrap

1. **`packages/cli/src/entry/cli.tsx`** — true entrypoint. `main()` dispatches fast paths (version, mcp, bridge, daemon, ps/logs/attach, dump-system-prompt, etc.) before falling through to `main.tsx`.
2. **`packages/cli/src/entry/main.tsx`** — Commander.js CLI definition. Subcommands: `mcp`, `server`, `ssh`, `open`, `auth`, `plugin`, `agents`, `auto-mode`, `doctor`, `update`, etc. The default `.action()` handler dispatches REPL vs headless via `mode-dispatch.ts`.
3. **`packages/cli/src/entry/mode-dispatch.ts`** — owns the REPL-launch / `--print` / `--continue` / `--resume` / setup branches. Calls `processSessionStartHooks`, `loadPluginHooks`, MCP prefetch.
4. **`packages/app-host/src/init.ts`** — one-shot init (`enableConfigs()`, env var application, OAuth populate, telemetry).

### Core Loop

- **`packages/agent/query.ts`** — turn-loop generator (the central API call function). Drives streaming response, tool dispatch, stop-hook handling.
- **`packages/agent/QueryEngine.ts`** — higher-level orchestrator wrapping `query()`. Owns conversation state, compaction, file-history snapshots, attribution.
- **`packages/repl/src/screens/REPLView.tsx`** — interactive REPL screen (Ink/React). Input handling, message display, permission prompts, keyboard shortcuts.
- **`packages/agent/core/AgentLoop.ts`** — the headless `-p` mode loop (used by `bun run dev -p` and SDK).

### API Layer

- **`packages/provider/src/`** — provider abstraction.
  - `claudeLegacyRuntime.ts` — main streaming path; calls `anthropic.beta.messages.create`.
  - `anthropic/client.ts` — Anthropic SDK client construction.
  - `openai/`, `gemini/`, `grok/`, `codex/` — alt-provider adapters (each translates Anthropic-shape requests/responses to its own SDK).
  - `cyberRiskInstruction.ts` — security-work authorization injected into the system prompt.
  - `connections.ts` — connection registry (single source of truth for provider config; env vars are fallback only).
- **Provider selection** in `packages/provider/src/providers.ts`.

### Tool System

- **`packages/tool-registry/src/tools/`** — 56 tool directories. Each: `<ToolName>/<ToolName>.ts(x)` (definition + `call()`), often with a UI component. Examples: BashTool, FileReadTool, FileEditTool, GrepTool, AgentTool, SkillTool, McpAuthTool, EnterPlanModeTool, etc.
- **`packages/tool-registry/src/tools/registry/`** — tool assembly + feature-gated inclusion.
- **`packages/tool-registry/src/services/toolExecution.ts`** — execution dispatcher (permission checks → call → result mapping).

### UI Layer

- **`packages/@ant/ink/`** — forked Ink (custom reconciler, hooks, virtual-list rendering).
- **`packages/repl/src/components/`** — REPL React components (170+).
  - `REPLView.tsx`, `Messages.tsx`, `MessageRow.tsx`, `PromptInput/`, `Settings/`, etc.
- **`packages/output/`** — non-REPL output rendering (headless `--print` mode).
- React Compiler runtime (`react/compiler-runtime`) — decompiled output has `_c()` memoization calls.

### State Management

- **`packages/app-host/src/state/AppState.tsx`** — central app state context.
- **`packages/app-host/src/state/AppStateStore.ts`** — store factory + defaults.
- **`packages/app-host/src/state/store.ts`** — Zustand-style store.
- **`packages/app-host/src/bootstrap/state.ts`** — module-level singletons (session ID, CWD, project root, registered hooks, token counts, model overrides, permission mode).
- **Selectors** — `state/selectors.ts`, `state/sessionSelectors.ts`, `state/permissionSelectors.ts`, `state/mcpSelectors.ts`, etc.

### Host Bindings

The codebase uses a **ports-and-adapters** pattern. Inner packages declare contracts; outer packages (`app-host`, `cli`) install bindings at startup.

- **`packages/app-host/src/runtime/installPluginBindings.ts`** — wires `@claude-code/config/plugin/_deps.ts` setters to real implementations.
- **`packages/app-host/src/runtime/bootstrap.ts`** — installs runtime skeleton bindings (logging, fs, plugins).
- **`packages/agent/host.ts`** — `installAgentHostBindings()` / `getAgentHostBindings()` — the agent package consumes hooks/messages/UI APIs through this.
- **`packages/agent/agentHostBindings.ts`** — concrete binding factory; `executeStopHooks`, `executeTaskCompletedHooks`, etc. all wire here.
- **Only one `_deps.ts` left**: `packages/config/plugin/_deps.ts` (cross-boundary plugin loader). Other packages migrated to direct imports + host bindings (V7 P7.1).

### Bridge / Daemon / Background Sessions

- **`packages/bridge/`** — Remote Control / Bridge mode (feature-gated `BRIDGE_MODE`). CLI: `ccb remote-control` / `ccb rc` / `ccb bridge`.
- **`packages/daemon/`** — long-running supervisor (feature-gated `DAEMON`).
- **Background sessions** — `ccb ps` / `logs` / `attach` / `kill` / `--bg` (feature-gated `BG_SESSIONS`).

### Context & System Prompt

- **`packages/agent/context.ts`** — assembles env info, git status, CLAUDE.md hierarchy.
- **`packages/agent/prompts.ts`** — `getSystemPrompt()` builds the static + dynamic prompt sections (default vs proactive paths).
- **`packages/storage/src/claudemd.ts`** — discovers and loads CLAUDE.md from project hierarchy.
- **`packages/config/outputStyles.ts`** — output style definitions (Default / Explanatory / Learning + user-defined `.md`).
- **`packages/agent/coordinatorMode.ts`** — coordinator-mode prompt (replaces default when `CLAUDE_CODE_COORDINATOR_MODE=1`).

### Feature Flag System

- **SSOT**: `scripts/default-features.ts` (`STABLE_FEATURES` array). Both `dev.ts` and `build.ts` import from here so dev and release stay aligned.
- **Per-run override**: `FEATURE_<NAME>=1 bun run dev`.
- **In code**: `import { feature } from 'bun:bundle'` then `feature('FLAG_NAME')` returns boolean.
- **Type**: declared in `packages/cli/src/types/internal-modules.d.ts`.
- **Full registry**: see `docs/feature-flags.md` (84 flags, categorised stable / opt-in / platform-detect).
- **Common stable flags** (currently default-on): `BRIDGE_MODE`, `CHICAGO_MCP`, `VOICE_MODE`, `TOKEN_BUDGET`, `TEMPLATES`, `COORDINATOR_MODE`, `MCP_SKILLS`, `TRANSCRIPT_CLASSIFIER`.
- **Don't redefine `feature` locally** — always import from `bun:bundle`.

### Key Restored / Reimplemented Modules

| Area | Status | Path |
|------|--------|------|
| Computer Use (macOS + Win) | Restored, working | `packages/@ant/computer-use-{mcp,input,swift}` |
| Chrome Native Host | Restored | `packages/@ant/claude-for-chrome-mcp` |
| Voice Mode (Push-to-Talk) | Restored, requires Anthropic OAuth | `packages/voice/` |
| OpenAI compat (Ollama/DeepSeek/vLLM) | Restored | `packages/provider/src/openai/` |
| Gemini compat | Restored | `packages/provider/src/gemini/` |
| Grok compat | Restored | `packages/provider/src/grok/` |
| Plugins / Marketplace | Restored | `packages/config/plugin/`, `packages/repl/src/components/plugin/` |
| MCP OAuth | Working | `packages/mcp-runtime/src/auth.ts` |
| audio-capture-napi, image-processor-napi, color-diff-napi | Implemented | `packages/*-napi/` |
| url-handler-napi, modifiers-napi | Stubs | `packages/*-napi/` |
| Analytics / GrowthBook / Sentry | Empty implementations | various |
| LSP Server (host side) | Removed | — |

### Provider Compat Layers

**OpenAI** (`CLAUDE_CODE_USE_OPENAI=1`):
- Stream adapter mode — Anthropic-shape requests get translated to OpenAI Chat Completions; SSE response gets translated back to `BetaRawMessageStreamEvent`. Downstream code is provider-agnostic.
- Env: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL`.

**Gemini** (`CLAUDE_CODE_USE_GEMINI=1`):
- Independent env namespace — does not share with OpenAI/Anthropic.
- Env: `GEMINI_API_KEY`, `GEMINI_BASE_URL` (default `https://generativelanguage.googleapis.com/v1beta`), `GEMINI_MODEL`, `GEMINI_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL`.

**Grok** — `packages/provider/src/grok/`. Similar adapter pattern.

## Testing

- **Framework**: `bun:test` (built-in assertions + mocks).
- **Layout**: tests live in `packages/<pkg>/src/**/__tests__/<name>.test.ts` (in-tree) or `tests/{integration,smoke,unit}/`.
- **Smoke**: `bun run smoke` — runtime probe + live-fire plugin hooks (validates host bindings, hook dispatch, real binary boot).
- **Mock pattern**: `mock.module()` + `await import()` — must be inlined per test file (cannot be hoisted to a shared helper).
- **Current state**: ~2317 pass / 0 fail across 148 files (39 in `packages/`, 109 elsewhere — see `scripts/health-check.ts`).

## Architecture Doctor

- **Run**: `bun run doctor:arch` — 60 rules covering owner-over-shim, encapsulation, ratchets, host-binding completeness, silent-failure detection, feature-flag boundaries, file-size LOC budgets, etc.
- **Pre-commit hook**: `.githooks/pre-commit` runs the fast subset (~8 rules, <2s). Wired by `bun install` (the `prepare` script sets `core.hooksPath`).
- **Pre-push hook**: full `doctor:arch` + smoke tests. See `.githooks/pre-push`.
- **Bypass**: `PRE_COMMIT_SKIP=1 git commit ...` only when you're certain the rule mis-flags. Don't use `--no-verify`.
- **Ratchets**: many rules count something (LOC, tsc errors, cycles, coupling, silent-failure findings) and lock the current value. They can shrink, not grow. To bump downward: do the work, run the verifier with `--tighten`, commit the new constant.

### Verifier Highlights

- **`verify-deps-setters-wired`** — every `_deps.ts` setter slot must be wired by some `installXxxBindings()` (P7.1 lock).
- **`verify-host-binding-completeness`** — every host binding contract method has a wire.
- **`verify-silent-failure-ratchet`** — 12-audit suite (`scripts/audit-silent-failures/`); current baseline ≈ 818 findings, all CRITICAL=0 / HIGH=0.
- **`verify-file-size`** — grandfathered LOC ratchet (`scripts/file-size-baseline.json`); new files ≤ 800 LOC.
- **`verify-tsc-errors`** — decompilation tsc-error budget (current ~3300, ratchet down only).
- **`verify-feature-canonical`** — `feature()` calls must come from `bun:bundle` import, not redefined.

## Versioning & Releases

**Tag scheme**: `v<year>.<month>.<Nth-of-month>` CalVer.

```
v26.4.1   ← Apr 2026, 1st release
v26.4.13  ← Apr 2026, 13th release
v26.5.1   ← May 2026, counter resets
```

- Strict 3-segment numeric → semver tools (`isVersionNewer`, npm semver, GitHub Release sort) all work natively.
- `26.4.99 < 26.5.1` holds correctly.
- One month rarely exceeds tens of releases — patch segment never overflows.
- Visually distinct from ant's `v2.1.NNN` series.
- **Don't put identifier strings (`carus`, etc.) in version numbers** — breaks sort. Identifiers go in `--version` output / banner / README.
- **Historical `v1.carus.NNN`** (001 ~ 009) retained as history. `v26.x.x > v1.x.x` numerically, so auto-update naturally moves users forward.

**Release flow**:
```bash
bun run release v26.4.14
```
- Creates the tag at HEAD, pushes it.
- GitHub Actions (`release.yml`) builds binaries for darwin-{arm64,x64} / linux-{arm64,x64} / win-x64, generates SHA256 sidecars, publishes to Releases.
- `MACRO.VERSION` is derived from the tag (`scripts/defines.ts`) — no manual version bump anywhere.
- Pre-flight in `scripts/release.ts`: clean working tree, valid tag, branch=main (override `--force-branch`).

**Auto-update**: built into the binary (`packages/updater/src/`). Polls GitHub Releases, downloads new platform binary, atomically swaps the version symlink.

## Working with This Codebase

- **Don't try to fix all tsc errors** — many come from decompilation (`unknown` / `never` / `{}` types). They don't affect Bun runtime. The ratchet locks the count from growing.
- **Build artifact is Bun-only** — `node dist/cli.js` does not work (Bun-native APIs in the bundle). Run via `bun dist/cli.js` or the release binary.
- **`bun:bundle` import** — Bun built-in module, resolved by the runtime/builder. Don't replace with a custom function.
- **MACRO defines** — only edit `scripts/defines.ts`. `MACRO.VERSION` comes from git tag.
- **Feature flags default-off** — every `feature('X')` returns `false` unless added to `STABLE_FEATURES` in `scripts/default-features.ts` or set per-run via `FEATURE_X=1`.
- **React Compiler output** — decompiled `const $ = _c(N)` memoization is normal, don't "clean it up".
- **Biome config** — many lint rules disabled (decompiled code isn't strict-lint-friendly). `.tsx` files: 120-col width + required semicolons; everything else: 80-col + as-needed.
- **No `src/` directory** — V7 refactor is complete. All code is under `packages/<pkg>/`. Inter-package imports use the `@claude-code/<pkg>` path; intra-package imports stay relative.
- **Plugin hooks** — `loadPluginHooks()` writes to `packages/config/plugin/_deps.ts` placeholders, which `installPluginBindings.ts` wires through to `app-host` STATE. Plugin hooks and registered callbacks live in the same `STATE.registeredHooks` slot. See `docs/feature-flags.md` and `packages/agent/hooks.ts`.
- **Personal self-hosted instance** — `CYBER_RISK_INSTRUCTION` (`packages/provider/src/cyberRiskInstruction.ts`) authorizes full security work for the operator. The repo is single-user; don't add gatekeeping for hypothetical multi-user concerns.

## Where to Look

- **Slow startup**: `packages/app-host/src/init.ts`, `packages/cli/src/setup/setup.ts`.
- **Stop hook didn't fire**: `packages/agent/internal/stopHooksCore.ts` → `packages/agent/agentHostBindings.ts:executeStopHooks` → `packages/agent/hooks.ts:executeStopHooks` → `hasHookForEvent` → `getRegisteredHooks()`.
- **Tool didn't run**: `packages/tool-registry/src/services/toolExecution.ts` (permission gate + dispatch).
- **MCP server didn't connect**: `packages/mcp-runtime/src/clientRuntime.ts`, `useManageMCPConnections.ts`.
- **Provider routing**: `packages/provider/src/providers.ts:resolveConnectionForModel`.
- **Plugin not loaded**: `packages/config/plugin/pluginLoader.ts:loadAllPluginsCacheOnly`, `loadPluginHooks.ts`.
- **CLAUDE.md not picked up**: `packages/storage/src/claudemd.ts`.
- **Feature flag not taking effect**: check `scripts/default-features.ts:STABLE_FEATURES` (build/dev) and `FEATURE_X=1` env var (per-run).
