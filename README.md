# Claude Code Best

[繁體中文](./README.zh-TW.md) | [简体中文](./README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/Icarus603/claude-code?style=flat-square&color=blue&label=release)](https://github.com/Icarus603/claude-code/releases)
[![Stars](https://img.shields.io/github/stars/Icarus603/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/Icarus603/claude-code/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=flat-square&color=green)](https://github.com/Icarus603/claude-code/commits/main)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](https://github.com/Icarus603/claude-code/releases/latest)

Terminal coding agent. Single binary, installed as `ccb`. Community-maintained derivative of Claude Code — see [`ATTRIBUTION.md`](./ATTRIBUTION.md). Not affiliated with Anthropic.

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

```bash
gh repo fork Icarus603/claude-code
git checkout -b feat/your-thing
bun run doctor:arch && bun test
gh pr create
```

---

## Releasing

Maintainer only:

```bash
bun run release v26.5.N
```

Validates, tags, pushes. GitHub Actions builds binaries for all platforms.

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [Official Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
