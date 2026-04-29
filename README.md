# Claude Code Best

[繁體中文](./README.zh-TW.md) | [简体中文](./README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/Icarus603/claude-code?style=flat-square&color=blue&label=release)](https://github.com/Icarus603/claude-code/releases)
[![Stars](https://img.shields.io/github/stars/Icarus603/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/Icarus603/claude-code/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=flat-square&color=green)](https://github.com/Icarus603/claude-code/commits/main)
[![Issues](https://img.shields.io/github/issues/Icarus603/claude-code?style=flat-square&color=orange)](https://github.com/Icarus603/claude-code/issues)
[![Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A51.3-black?style=flat-square&logo=bun&logoColor=white)](https://bun.sh/)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](https://github.com/Icarus603/claude-code/releases/latest)

Terminal coding agent. Single binary, installed as `ccb`. Community-maintained derivative of Claude Code — see [`ATTRIBUTION.md`](./ATTRIBUTION.md). Not affiliated with Anthropic; for the official tool, see <https://docs.anthropic.com/en/docs/claude-code/overview>. No standalone license file is shipped — review provenance before redistribution.

---

## 📦 Install

**macOS / Linux** (also Git Bash / WSL on Windows):

```bash
curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | bash
```

Installs to `~/.local/share/ccb/versions/<version>` with a symlink at `~/.local/bin/ccb`.

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Icarus603/claude-code/main/install.ps1 | iex
```

Installs to `%LOCALAPPDATA%\Programs\ccb\versions\<version>.exe` with a shim at `%LOCALAPPDATA%\Programs\ccb\bin\ccb.exe`, and adds the bin directory to your user `PATH` automatically. No admin rights required.

No Node, no Bun, no package manager required for either.

| Variable | Default (sh / ps1) | Effect |
|----------|---------|--------|
| `CCB_VERSION` | `latest` | Pin a specific tag, e.g. `v26.4.24` |
| `CCB_PREFIX`  | `~/.local` / `%LOCALAPPDATA%\Programs\ccb` | Install root |

**Upgrade**: nothing to do. `ccb` checks GitHub Releases on every REPL startup (and every 30 min while running) and installs new versions in the background — you'll see `✓ Update installed · Restart to update` in the footer when one lands. Re-running the install one-liner still works if you want to force a specific version via `CCB_VERSION=…`.

Uninstall:
- macOS / Linux: `rm -rf ~/.local/share/ccb ~/.local/bin/ccb`
- Windows: `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\ccb"`

> Windows ARM64 is not supported (Bun has no `windows-arm64` compile target). Use the x64 binary under x64 emulation, or run via WSL.

---

## 🚀 Usage

```bash
ccb              # interactive REPL
ccb --version
ccb --help
```

First run prompts `/login`. The dialog lets you pick a provider:

- **Anthropic Console account** — OAuth flow for claude.ai (Pro / Max / Team / Enterprise)
- **ChatGPT Codex** — OAuth flow for ChatGPT (Plus / Pro / Business / Edu / Enterprise); uses your ChatGPT plan quota, not API key billing. Models served from `chatgpt.com/backend-api/codex/responses` (gpt-5.5 / 5.4 / 5.4-mini / 5.3-codex / 5.2 with `low|medium|high|xhigh` reasoning effort)
- **Anthropic Compatible** — any Anthropic-format endpoint (Anthropic itself, third-party proxies, self-hosted)
- **OpenAI Compatible** — OpenAI itself plus anything that speaks the protocol (DeepSeek, Ollama, vLLM, …)
- **Gemini API** — Google Gemini native REST/SSE

Multiple connections coexist in the same session — log into Claude Account *and* ChatGPT Codex, then switch between them per-request via `/model`. Each row in the picker is one connection × one model. `/effort` honors each model's tier-correct level set; `/status` shows usage for every connected provider.

You paste base URL + API key + model IDs inside the dialog (where applicable); nothing to set in your shell. Switch providers anytime with `/login` again.

See [`CLAUDE.md`](CLAUDE.md) for the architecture overview, [`docs/feature-flags.md`](docs/feature-flags.md) for the flag registry.

### 🤖 Headless / scripted use

For CI or `--print` mode where there's no REPL to drive `/login`, env vars work too:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | Anthropic auth + endpoint |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_DEFAULT_*_MODEL` | OpenAI-compat endpoint |
| `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_DEFAULT_*_MODEL` | Gemini endpoint |
| `FEATURE_<FLAG>=1` | Enable a build-time feature gate at runtime |

---

## 🛠️ Build from source

[Bun](https://bun.sh) ≥ 1.3.0 is the only requirement.

```bash
git clone https://github.com/Icarus603/claude-code.git
cd claude-code
bun install

bun run dev               # hot-reload, no build step
bun run build:standalone  # → dist/ccb (current platform)
bun run build:platforms   # → dist/binaries/ccb-{darwin,linux,windows}-{arm64,x64}[.exe]
bun test
bun run doctor:arch       # architectural invariants — must pass
```

`bun build --compile --target=bun-<os>-<arch>` cross-compiles in ~0.4s per platform. The release workflow ([`.github/workflows/release.yml`](.github/workflows/release.yml)) does this on tag push.

---

## 🤝 Contributing

PRs welcome.

- `bun run doctor:arch` must pass. No `--no-verify`.
- `bun test` must pass. Add tests for new behavior.
- `tsc-errors` ratchet only allows the count to decrease.
- Commit messages explain *why*; the diff already shows *what*.
- Don't add npm distribution back. This is binary-only by design.

```bash
gh repo fork Icarus603/claude-code
git checkout -b feat/your-thing
# ...
bun run doctor:arch && bun test
gh pr create
```

Architectural conventions live in [`docs/lazy-require-pattern.md`](docs/lazy-require-pattern.md) and the doctor scripts under [`scripts/`](scripts/).

---

## 🏷️ Releasing

Maintainer only.

```bash
bun run release v26.4.25
```

That's it. The script validates the tag, creates it, pushes it. GitHub Actions then builds 5 binaries (with `MACRO.VERSION` derived from the tag itself — no version strings to bump anywhere) and uploads them to Releases.

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [`docs/`](docs/) · [Anthropic's official Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
