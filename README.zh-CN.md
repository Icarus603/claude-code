# Claude Code Best

[English](./README.md) | [繁體中文](./README.zh-TW.md)

[![Release](https://img.shields.io/github/v/release/Icarus603/claude-code?style=for-the-badge&color=0f0f0f&label=ccb)](https://github.com/Icarus603/claude-code/releases)
[![Bun](https://img.shields.io/badge/runtime-bun-F9F1E1?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/Icarus603/claude-code)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=for-the-badge&color=222&label=updated)](https://github.com/Icarus603/claude-code/commits/main)
[![Platforms](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-333333?style=for-the-badge)](https://github.com/Icarus603/claude-code/releases/latest)

终端编程智能体。单一 binary `ccb`。同一个 agent loop 对接 Anthropic、OpenAI 兼容端点（Ollama、DeepSeek、vLLM……）、Gemini、Grok。支持 macOS、Linux、Windows。

Claude Code 的个人维护公开衍生版；baseline 由 v2.1.88 sourcemap 重建（2026-03-31）。详见 [`ATTRIBUTION.md`](./ATTRIBUTION.md)。与 Anthropic 无关。

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
- PR 由单一维护者以人类速度 review，无 SLA。
- 非 trivial PR 请先开 [Issue](https://github.com/Icarus603/claude-code/issues) 讨论。

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [Anthropic 官方 Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
