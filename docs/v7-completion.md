# V7 Completion

This document captures the final state of the V7 architecture refactor — what
landed, how the codebase is shaped, and which doctor rules guard against
regression. It is the "you have arrived" sign for V7; further work should
either keep the metrics moving in the locked direction or update the budgets
deliberately.

## Layout

```
src/                  – thin entrypoints only (cli.tsx, main.tsx) + facades
packages/             – domain ownership, one package per V7 §8 subsystem
  @ant/                  – integrations namespace (computer-use, ink fork)
  agent/                 – core agent loop, query, tools dispatch
  app-host/              – composition root, bootstrap state, command registry
  bridge/                – remote-control (BRIDGE_MODE)
  cli/                   – Commander tree, headless SDK runner
  command-runtime/       – slash command parsing + canonical implementations
  config/                – settings, env gates, platform, plugin loader
  daemon/                – long-running supervisor (DAEMON)
  headless-sdk/          – programmatic SDK surface
  ide/                   – VS Code / JetBrains terminal adapters
  local-observability/   – logging, telemetry, span tracing, errors
  mcp-runtime/           – MCP client/server runtime
  memory/                – CLAUDE.md discovery + auto-memory
  output/                – formatters, ANSI, truncation, figures
  permission/             – tool permission policy + UIs
  provider/              – LLM provider adapters (Anthropic / Bedrock /
                            Vertex / Azure / OpenAI / Gemini)
  repl/                  – Ink/React REPL screen + every UI submodule
  server/                – HTTP/WS endpoints, SSH bridge
  shell/                 – Bash AST, sandbox-aware exec, PowerShell parser
  storage/               – persistence, claudemd, secure storage
  swarm/                 – multi-agent worktree sessions
  teleport/              – cross-machine session resume
  tool-registry/         – built-in tools + registry assembly
  updater/               – CLI self-update flow
  voice/                 – push-to-talk + STT (VOICE_MODE)
```

## Doctor rules (42 total, all passing)

The full ratcheted set lives in `scripts/doctor-architecture.ts`. Each rule
has its own `scripts/verify-*.ts`. Key invariants enforced:

- **Owner-over-shim** (`reverse-shims`, `duplicate-canonicals`): every concept
  has exactly one canonical home in `packages/`; src/ may only forward-shim,
  never fork.
- **Thin host** (`replview-shrinks`, `entry-thin-host`): REPLView and the CLI
  entry decrease monotonically; new logic must land in submodules.
- **src/ evacuation** (`src-shrinks`): non-entrypoint src/ LOC ratchets toward
  zero. Entrypoints (cli.tsx, main.tsx) and §10.3 facades excluded.
- **Encapsulation** (`package-private-src`, `package-exports`): cross-package
  imports go through the public exports map; `@claude-code/X/src/...` is
  forbidden.
- **Documentation** (`package-readme`): every package documents its V7
  responsibility.
- **Coupling** (`cross-package-coupling`): per-package distinct dependency
  counts may shrink but never grow.
- **Build integrity** (`build-resolves`, `runtime-boundaries`,
  `require-src-imports`): `bun build` resolves end-to-end; static and dynamic
  imports do not bypass the boundary checks.
- **Naming hygiene** (`no-holding-pens`): no `*_v7`, `*_dir`, `*_topdir`,
  `legacy_*` suffixes in `packages/`.

## What still requires care

1. **REPLView is still ~5650 LOC.** It is monotonically shrinking but is the
   largest remaining domain-orchestration host. Continue extracting hooks /
   subcomponents, one self-contained unit at a time.
2. **src/utils/* forward shims (~250 files).** Each is a 4-line re-export
   pointing into `packages/`. They could be inlined at the call site OR
   batched away once every consumer has been canonicalized. Tracked by #77.
3. **§10.3 init-side-effect facades.** A small number of src/ files exist
   solely to wire setter callbacks at boot (envUtils, format, cachePaths).
   These are intentional but periodically audit (#78) to ensure the list
   does not grow.
4. **Cross-package coupling ceilings.** The current ratchet locks today's
   numbers; reducing them is the next quality lever (#85 successor work).

## Concurrency hazards

The `auto memory` notes capture several recurring traps from this refactor —
read these before non-trivial moves:

- macOS case-insensitive FS overwrites silently (`feedback_macos_case_insensitive_shim_trap.md`).
- `git checkout HEAD -- <path>` discards uncommitted V7 work (lesson from
  iter 13). Prefer `git stash` or surgical `git restore --staged`.
- Parallel sessions can land theme/UI fixes that revert canonical paths.
  Treat any unexpected `from 'src/...'` regression as a working-tree
  pollution event before assuming intent.
- Concurrent ralph-loops on shared `main` branch can race; each session
  should either work in a worktree or commit small batches with doctor
  green between each.

## How to extend

- **Adding a new package:** create `packages/<name>/`, add `package.json`
  with proper `exports`, write a `README.md`, and run
  `bun run scripts/doctor-architecture.ts`. The new ratchet rules will
  pick it up automatically (you may need to add a budget entry to
  `verify-cross-package-coupling.ts`).
- **Moving code from src/ to a package:** use `scripts/flip-reverse-shim.ts`
  for tiny re-export flips, or `scripts/move-to-package.ts` for whole
  directories. After every move: doctor green, commit.
- **Adding a cross-package import:** if it pushes a package over its
  coupling budget, the verifier will block. Either reduce another dep
  in the same package or update the budget with a justification.

doctor:arch as of HEAD: **42 passed · 0 failed · 0 missing.**
