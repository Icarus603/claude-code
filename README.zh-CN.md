# Claude Code Best

[English](./README.md) | [繁體中文](./README.zh-TW.md)

[![Release](https://img.shields.io/github/v/release/Icarus603/claude-code?style=flat-square&color=blue&label=release)](https://github.com/Icarus603/claude-code/releases)
[![Stars](https://img.shields.io/github/stars/Icarus603/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/Icarus603/claude-code/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=flat-square&color=green)](https://github.com/Icarus603/claude-code/commits/main)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](https://github.com/Icarus603/claude-code/releases/latest)

终端编程智能体。单一 binary，命令为 `ccb`。Claude Code 的社区维护衍生版 — 详见 [`ATTRIBUTION.md`](./ATTRIBUTION.md)。与 Anthropic 无关。

---

## 安装

**macOS / Linux**（Windows 的 Git Bash / WSL 也适用）：

```bash
curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | bash
```

**Windows**（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/Icarus603/claude-code/main/install.ps1 | iex
```

无需 Node、Bun 或任何包管理器。每次启动自动检查更新。

**卸载：**

```bash
# macOS / Linux
rm -rf ~/.local/share/ccb ~/.local/bin/ccb

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\ccb"
```

> 不支持 Windows ARM64，请在 x64 模拟下运行，或改走 WSL。

---

## 贡献

需要 [Bun](https://bun.sh) ≥ 1.3。

```bash
git clone https://github.com/Icarus603/claude-code.git
cd claude-code
bun install
bun run dev        # hot-reload REPL
bun test
bun run doctor:arch
```

- `doctor:arch` 和 `bun test` 必须通过。不准 `--no-verify`。
- Commit message 解释 *为什么*。
- 不要把 npm 发布加回来 — 本项目 binary-only。

```bash
gh repo fork Icarus603/claude-code
git checkout -b feat/your-thing
bun run doctor:arch && bun test
gh pr create
```

---

## 发版

只给维护者：

```bash
bun run release v26.5.N
```

校验、打 tag、push。GitHub Actions 自动构建全平台 binary。

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [Anthropic 官方 Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
