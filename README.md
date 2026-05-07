# Claude Code Best

[繁體中文](./README.zh-TW.md) | [简体中文](./README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/Icarus603/claude-code?style=for-the-badge&color=0f0f0f&label=ccb)](https://github.com/Icarus603/claude-code/releases)
[![Bun](https://img.shields.io/badge/runtime-bun-F9F1E1?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/Icarus603/claude-code)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=for-the-badge&color=222&label=updated)](https://github.com/Icarus603/claude-code/commits/main)
[![Platforms](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-333333?style=for-the-badge)](https://github.com/Icarus603/claude-code/releases/latest)

Terminal coding agent. Single binary `ccb`. Talks to Anthropic, OpenAI-compatible endpoints (Ollama, DeepSeek, vLLM, …), Gemini, and Grok through one agent loop. macOS, Linux, Windows.

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

**Uninstall:**

```bash
# macOS / Linux
rm -rf ~/.local/share/ccb ~/.local/bin/ccb

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\ccb"
```

> Windows ARM64 is not supported. Use x64 under emulation, or WSL.

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

[Issues](https://github.com/Icarus603/claude-code/issues) · [Official Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
