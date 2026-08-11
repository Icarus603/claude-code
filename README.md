# Claude Code Best

[繁體中文](./README.zh-TW.md) | [简体中文](./README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/Icarus603/claude-code?style=flat&color=80BDFF&label=ccb)](https://github.com/Icarus603/claude-code/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Icarus603/claude-code/ci.yml?branch=main&style=flat&label=ci)](https://github.com/Icarus603/claude-code/actions/workflows/ci.yml)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=flat&color=7C3AED&label=updated)](https://github.com/Icarus603/claude-code/commits/main)
[![Stars](https://img.shields.io/github/stars/Icarus603/claude-code?style=flat&color=D4A017)](https://github.com/Icarus603/claude-code/stargazers)
[![Platforms](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-1F4E8C?style=flat)](https://github.com/Icarus603/claude-code/releases/latest)
[![Bun](https://img.shields.io/badge/runtime-bun-F9F1E1?style=flat&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://github.com/Icarus603/claude-code)

[![Models](https://img.shields.io/badge/MODELS-722F37?style=flat)](#install)
[![Claude Subscription](https://img.shields.io/badge/Claude%20Subscription-D97757?style=flat&logo=claude&logoColor=fff)](https://claude.ai/upgrade)
[![Anthropic API](https://img.shields.io/badge/Anthropic%20API-191919?style=flat&logo=anthropic&logoColor=fff)](https://console.anthropic.com)
[![Anthropic Compatible](https://img.shields.io/badge/Anthropic%20Compatible-CC785C?style=flat&logo=anthropic&logoColor=fff)](https://docs.anthropic.com/en/api)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI%20Compatible-10A37F?style=flat)](https://platform.openai.com/docs/api-reference/chat)
[![ChatGPT Codex](https://img.shields.io/badge/ChatGPT%20Codex-0E7C5E?style=flat)](https://openai.com/codex)
[![Gemini](https://img.shields.io/badge/Gemini-4285F4?style=flat&logo=googlegemini&logoColor=fff)](https://ai.google.dev)

Terminal coding agent. Single binary `ccb`. Talks to Anthropic (OAuth or API key), Anthropic-compatible endpoints, ChatGPT Codex (OAuth), OpenAI-compatible endpoints (Ollama, DeepSeek, vLLM, …), and Gemini through one agent loop. macOS, Linux, Windows.

Solo-maintained public derivative of Claude Code; baseline reconstructed from the v2.1.88 sourcemap (2026-03-31), with selected behavior ported and verified through 2.1.207. Decode, semantic-analysis, port, and verification states are tracked separately. See [`ATTRIBUTION.md`](./ATTRIBUTION.md), [`project history`](./docs/project-history.md), and the [`upstream compatibility baseline`](./docs/upstream-compatibility.md). Not affiliated with Anthropic.

---

## Install

**macOS / Linux** (also Git Bash / WSL):

```bash
curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | bash
```

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Icarus603/claude-code/main/install.ps1 | iex
```

No Node, no Bun, no package manager required. Auto-updates on every startup.

---

## Quick Start

Open a terminal — on **macOS** press `⌘ Space`, type `Terminal`, hit Enter. On **Linux** press `Ctrl Alt T`. On **Windows** open **PowerShell** from the Start menu.

Then run:

```bash
ccb
```

That drops you into an interactive REPL. Type any task in plain English and press `Enter`:

```
> refactor the auth module to use async/await
> explain what this codebase does
> write tests for src/utils/parser.ts
```

**One-shot mode** (no REPL, prints and exits):

```bash
ccb -p "what does package.json do?"
```

**Continue the last conversation:**

```bash
ccb --continue
```

**Inside the REPL:**

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Escape` | Cancel current response |
| `/help` | Show all slash commands |
| `Ctrl+C` | Exit |

> Windows ARM64 is not supported. Use x64 under emulation, or WSL.

---

## Learn ccb in 10 minutes — `/powerup`

New here? Inside the REPL, type:

```
/powerup
```

Ten short interactive lessons walk you through what makes ccb worth using — `@` file mentions, permission modes, `/rewind` and Esc-Esc to undo, background sessions, CLAUDE.md, MCP, skills + hooks, `/fork` for parallel branches, model dialing, and multi-provider switching. Open one, try it, mark it done. The home banner tracks progress until you've finished all ten.

---

## Memory consolidation — `/dream`

<p align="center">
  <img src="assets/dream-demo.gif" alt="ccb /dream command demo" width="100%">
</p>

ccb keeps a persistent, file-based memory under `~/.claude/projects/<project>/memory/` — a `MEMORY.md` index plus typed topic files (`user`, `feedback`, `project`, `reference`). It writes to these as it works so a fresh session can orient fast. Over many sessions those files drift: entries go stale, duplicate each other, or contradict the current code. `/dream` is the reflective pass that cleans them up.

Inside the REPL, type:

```
/dream
```

It runs **right now, in the foreground, with full tool access** while you watch. The model does a four-phase pass over your memory directory:

1. **Orient** — `ls` the memory dir, read `MEMORY.md`, skim topic files and recent session logs so it improves rather than duplicates.
2. **Gather** — pull new signal from session logs and transcripts (grepped narrowly, never read whole), and flag memories that have drifted from the code.
3. **Consolidate** — merge new signal into existing files, convert relative dates to absolute, delete contradicted facts.
4. **Prune & index** — keep `MEMORY.md` an index (one line per entry, under 200 lines / ~25 KB), drop superseded pointers, reconcile against `CLAUDE.md`.

When it's done you get a short summary of what was consolidated, updated, or pruned.

### Three modes

| Command | What it does |
|---------|--------------|
| `/dream` | Consolidate now — foreground, full tools, you're watching. Accepts trailing text as extra context (e.g. `/dream focus on the auth refactor`). |
| `/dream nightly` | Schedule a recurring nightly consolidation. Installs a `durable`, `recurring` cron that fires `/dream consolidate` at a random minute between 00:00–05:59 local (jittered to avoid thundering-herd across sessions). The schedule persists in `.claude/scheduled_tasks.json` across sessions. |
| `/dream consolidate` | The bare consolidation body with no manual-mode preface — what the nightly cron fires. You can also run it by hand. |

`/dream` also has the alias `/learn`.

### Nightly notes

- Recurring jobs **auto-expire after 7 days** — re-run `/dream nightly` to renew. (Re-running also de-dupes: it deletes any existing `/dream consolidate` job before scheduling a fresh one.)
- Cancel anytime — list jobs and delete by ID via the cron tools, or toggle the **Auto-dream** row in `/memory`.
- Requires auto-memory to be on. The command is hidden in remote mode and when auto-memory is disabled.

---

## Recurring & self-paced tasks — `/loop`

`/loop` turns any prompt or slash command into a repeating job. Two ways to run it: a fixed interval, or no interval at all — in which case the model decides how long to wait between iterations based on what it just saw.

Inside the REPL:

```
/loop 5m /babysit-prs        # run /babysit-prs every 5 minutes
/loop 30m check the deploy   # run a plain prompt every 30 minutes
/loop check the deploy       # no interval → model self-paces the cadence
/loop                        # bare → autonomous check, dynamically paced
```

The interval is the leading token (`5m`, `2h`, `1d`) or a trailing `every …` clause (`check the deploy every 20m`, `run tests every 5 minutes`). Granularity is 1 minute minimum. `/loop` runs the task **immediately**, then schedules the next firing — you don't wait for the first tick.

| Form | Behaviour |
|------|-----------|
| `/loop <interval> <prompt>` | Fixed cadence. Converts the interval to a cron, fires recurring until you cancel. |
| `/loop <prompt>` (no interval) | Dynamic mode — after each run the model picks the next delay (via `ScheduleWakeup`) from what it observed: quiet branch → wait longer, lots in flight → wait shorter. |
| `/loop` (bare) | Autonomous default in dynamic-pacing mode — runs a check now, self-paces from there. |

`/loop` also has the alias `/proactive`.

**Notes**

- Recurring (fixed-interval) jobs **auto-expire after 7 days** — re-run to renew. Dynamic-mode loops stop the moment the model declines to schedule the next wake-up.
- List jobs with `/cron-list`, cancel with `/cron-delete <id>`.
- If an interval can't be expressed cleanly as cron (e.g. `7m`, `90m`), the model rounds to the nearest clean cadence and tells you what it picked.
- GA by default. Disable the whole scheduler locally with `CLAUDE_CODE_DISABLE_CRON=1`.

---

## Agents view — `ccb agents`

<p align="center">
  <img src="assets/fleetview-demo.gif" alt="ccb agents view demo" width="100%">
</p>

A TUI dashboard for orchestrating background sessions. Type:

```bash
ccb agents
```

You get a live list of every background session grouped by state (Needs input · Working · Done), a dispatch input to launch new ones, and a peek panel for reading any session's recent activity without attaching.

**Inside the agents view:**

| Key | Action |
|-----|--------|
| Type then `Enter` | Dispatch a new background session with that task |
| `Shift+Enter` | Newline in the dispatch input |
| `↑` / `↓` | Move focus between sessions |
| `→` | Attach into the focused session |
| `Space` | Peek the focused session (reply inline without attaching) |
| `Tab` | Toggle the agents drawer / accept suggestion |
| `@name` / `/cmd` | Mention an agent, skill, or repo |
| `Shift+↑` / `Shift+↓` | Reorder within a bucket |
| `Ctrl+R` | Rename the focused session |
| `Ctrl+T` | Pin the focused session to the top |
| `Ctrl+X` | Stop / delete the focused session (two-step) |
| `Ctrl+S` | Switch grouping (by state ↔ by directory) |
| `Ctrl+G` | Open the dispatch buffer in `$EDITOR` |
| Click | Click a row to focus it; click inside the input to move the cursor |
| `?` | Open the in-view help overlay |
| `Esc` | Clear input, then exit |
| `Ctrl+C` | Confirm-then-exit (background sessions keep running) |

Sessions are PTY-backed and survive after you close the terminal — re-open `ccb agents` later to find them. Dispatch goes through a spare-worker pool so a fresh session boots in ~0ms when one is ready.

---

## Agent Teams — coordinate multiple sessions

<p align="center">
  <img src="assets/swarm-demo.gif" alt="ccb Agent Teams swarm demo" width="100%">
</p>

Agent Teams let you coordinate several ccb instances working together. One session acts as the **team lead** — it assigns work, synthesizes results, and coordinates. Each **teammate** is a full, independent session with its own context window, and teammates message each other directly. Unlike a plain subagent (which runs inside one session and only reports back to the main agent), you can also talk to any teammate directly without going through the lead.

**You have to ask for a team — it won't form on its own.** Describe the task and the team shape in plain English and the lead sets everything up. ccb may also *propose* a team if it spots parallelizable work, but it always waits for your confirmation first. Either way, nothing spawns without your say-so.

```
> Users report the app exits after one message instead of staying connected.
  Create an agent team: spawn 4 teammates to investigate different hypotheses,
  have them message each other to disprove each other's theories like a
  scientific debate, and update the findings doc with the consensus.
```

The lead creates a shared task list, spawns teammates, lets them claim and work tasks (with dependencies auto-unblocking as blockers complete), synthesizes the results, and cleans up the team when done. In the REPL, cycle teammates with `Shift+Down` and message any one directly; or run split panes (tmux / iTerm2) to watch everyone at once.

### When to use a team

Teams shine when parallel exploration adds real value and teammates can work independently:

- **Research & review** — split a PR review or a library investigation into independent lenses (security, performance, test coverage) that run at once.
- **New modules or features** — each teammate owns a separate piece without stepping on the others.
- **Debugging with competing hypotheses** — teammates test different theories in parallel and argue them out, which beats a single agent that anchors on the first plausible cause.
- **Cross-layer coordination** — a change spanning frontend, backend, and tests, each layer owned by a different teammate.

**When not to:** teams add coordination overhead and burn significantly more tokens (each teammate is a separate session). For sequential work, same-file edits, or heavily dependent tasks, a single session or a [subagent](#agents-view--ccb-agents) is the better tool. New to teams? Start with research or review — clear boundaries, no parallel-write conflicts.

### Tips

- **Start with 3–5 teammates.** Past that, coordination overhead and token cost outweigh the parallelism; three focused teammates beat five scattered ones.
- **Split along file boundaries.** Two teammates editing the same file overwrite each other — give each its own set of files.
- **Give each teammate enough context.** They load `CLAUDE.md`, MCP, and skills like any session, but they do *not* inherit the lead's conversation — put task-specific detail in the spawn prompt.
- **Steer as it runs.** Press Enter on a teammate to read its session, Escape to interrupt; redirect approaches that aren't working rather than letting the team run unattended.
- GA by default in ccb — no env var, no CLI flag (upstream still gates it behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`). Teams are cleaned up at session end.

---

## Workflows — `ultrawork` & the Workflow tool

Workflows are ccb's **deterministic** multi-agent orchestration primitive. Where an Agent Team is a loose, conversational group of sessions, a Workflow is a single JavaScript script that spawns subagents through `agent()` / `parallel()` / `pipeline()` / `phase()` calls, runs them in a sandbox in the background, and can be **resumed** — completed agents return cached results so only edited or new steps re-run.

**Three ways in:**

1. **The `ultrawork` keyword.** Drop `ultrawork` anywhere in your prompt and it lights up with a rainbow shimmer (like `ultrathink` / `ultraplan`), with a "will use the Workflow tool" hint. It steers the model to treat the request as a sustained, orchestrated unit of work rather than a one-shot reply.

   ```
   > ultrawork: migrate every call site off the old auth middleware,
     one subagent per package, then verify the build
   ```

2. **The Workflow tool**, invoked by the model. It compiles a self-contained script and launches it in the background:

   ```js
   export const meta = { name: 'audit', description: 'Per-package lint audit', phases: [] }
   const pkgs = ['cli', 'agent', 'repl']
   const results = await parallel(pkgs.map(p =>
     () => agent(`Lint-audit packages/${p} and report findings`)))
   log(results)
   ```

   Scripts must be **deterministic** — `Date.now()`, `Math.random()`, and `new Date()` are rejected so a resumed run reproduces exactly. Caps: up to 1000 subagents, `min(16, cpus-2)` concurrency, 180s stall detection, 5 retries.

3. **`/workflows`** — a history browser for running and completed workflow runs (status · agent count · tokens · duration). `↑`/`↓` to select, `Enter` to view, `x` to stop a running one.

**Notes**

- **On by default** in ccb (solo-operator, same rationale as `/goal`). Disable locally with `CLAUDE_CODE_WORKFLOWS=0`. Upstream gates the same subsystem behind an opt-*in* `CLAUDE_CODE_WORKFLOWS` env var plus a server flag; ccb flips it to opt-*out*.
- Subagents inside a workflow can't recursively launch another workflow.
- Named workflows (built-in scripts + a `.claude/workflows/` registry) are a planned follow-up — for now provide an inline `script` or a `scriptPath`.

---

## Contributing

Requires [Bun](https://bun.sh) ≥ 1.3.

```bash
git clone https://github.com/Icarus603/claude-code.git
cd claude-code
bun install
bun run dev        # hot-reload REPL
bun test
bun run doctor:arch
```

- `doctor:arch` and `bun test` must pass. No `--no-verify`.
- Commit messages explain *why*.
- No npm publishing — binary-only by design.
- PRs are reviewed by one maintainer at human pace. No SLA.
- Open an [Issue](https://github.com/Icarus603/claude-code/issues) before non-trivial PRs.

---

## Uninstall

```bash
# macOS / Linux
rm -rf ~/.local/share/ccb ~/.local/bin/ccb

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\ccb"
```

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [Official Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
