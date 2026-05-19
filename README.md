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

Solo-maintained public derivative of Claude Code; baseline reconstructed from the v2.1.88 sourcemap (2026-03-31). See [`ATTRIBUTION.md`](./ATTRIBUTION.md). Not affiliated with Anthropic.

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

## Agents view — `ccb agents`

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

## Learn ccb in 10 minutes — `/powerup`

New here? Inside the REPL, type:

```
/powerup
```

Ten short interactive lessons walk you through what makes ccb worth using — `@` file mentions, permission modes, `/rewind` and Esc-Esc to undo, background sessions, CLAUDE.md, MCP, skills + hooks, `/fork` for parallel branches, model dialing, and multi-provider switching. Open one, try it, mark it done. The home banner tracks progress until you've finished all ten.

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
