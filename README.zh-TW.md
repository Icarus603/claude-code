# Claude Code Best

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/Icarus603/claude-code?style=for-the-badge&color=0f0f0f&label=ccb)](https://github.com/Icarus603/claude-code/releases)
[![Bun](https://img.shields.io/badge/runtime-bun-F9F1E1?style=for-the-badge&logo=bun&logoColor=000)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/Icarus603/claude-code)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=for-the-badge&color=222&label=updated)](https://github.com/Icarus603/claude-code/commits/main)
[![Platforms](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-333333?style=for-the-badge)](https://github.com/Icarus603/claude-code/releases/latest)

終端編程智慧體。單一 binary `ccb`。同一個 agent loop 對接 Anthropic、OpenAI 相容端點（Ollama、DeepSeek、vLLM……）、Gemini、Grok。支援 macOS、Linux、Windows。

Claude Code 的個人維護公開衍生版；baseline 由 v2.1.88 sourcemap 重建（2026-03-31）。詳見 [`ATTRIBUTION.md`](./ATTRIBUTION.md)。與 Anthropic 無關。

---

## 安裝

**macOS / Linux**（Windows 的 Git Bash / WSL 也適用）：

```bash
curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | bash
```

**Windows**（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/Icarus603/claude-code/main/install.ps1 | iex
```

不需要 Node、Bun 或任何套件管理器。每次啟動自動檢查更新。

**解除安裝：**

```bash
# macOS / Linux
rm -rf ~/.local/share/ccb ~/.local/bin/ccb

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\ccb"
```

> 不支援 Windows ARM64，請在 x64 模擬下執行，或改走 WSL。

---

## 貢獻

需要 [Bun](https://bun.sh) ≥ 1.3。

```bash
git clone https://github.com/Icarus603/claude-code.git
cd claude-code
bun install
bun run dev        # hot-reload REPL
bun test
bun run doctor:arch
```

- `doctor:arch` 和 `bun test` 必須通過。不准 `--no-verify`。
- Commit message 解釋 *為什麼*。
- 不要把 npm 發布加回來 — 本專案 binary-only。
- PR 由單一維護者以人類速度 review，無 SLA。
- 非 trivial PR 請先開 [Issue](https://github.com/Icarus603/claude-code/issues) 討論。

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [Anthropic 官方 Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
