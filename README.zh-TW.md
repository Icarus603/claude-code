# Claude Code Best

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/Icarus603/claude-code?style=flat-square&color=444444&label=ccb)](https://github.com/Icarus603/claude-code/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Icarus603/claude-code/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/Icarus603/claude-code/actions/workflows/ci.yml)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=flat-square&color=444444&label=updated)](https://github.com/Icarus603/claude-code/commits/main)
[![Stars](https://img.shields.io/github/stars/Icarus603/claude-code?style=flat-square&color=444444)](https://github.com/Icarus603/claude-code/stargazers)
[![Platforms](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-1F4E8C?style=flat-square)](https://github.com/Icarus603/claude-code/releases/latest)
[![Bun](https://img.shields.io/badge/runtime-bun-F9F1E1?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://github.com/Icarus603/claude-code)

[![Models](https://img.shields.io/badge/%E6%A8%A1%E5%9E%8B-D4A017?style=flat-square)](#install)
[![Claude Subscription](https://img.shields.io/badge/Claude%20Subscription-444444?style=flat-square&logo=claude&logoColor=D97757)](https://claude.ai/upgrade)
[![Anthropic API](https://img.shields.io/badge/Anthropic%20API-444444?style=flat-square&logo=anthropic&logoColor=white)](https://console.anthropic.com)
[![Anthropic Compatible](https://img.shields.io/badge/Anthropic%20Compatible-444444?style=flat-square&logo=anthropic&logoColor=D97757)](https://docs.anthropic.com/en/api)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI%20Compatible-444444?style=flat-square)](https://platform.openai.com/docs/api-reference/chat)
[![ChatGPT Codex](https://img.shields.io/badge/ChatGPT%20Codex-10A37F?style=flat-square)](https://openai.com/codex)
[![Gemini](https://img.shields.io/badge/Gemini-444444?style=flat-square&logo=googlegemini&logoColor=4285F4)](https://ai.google.dev)
[![Grok](https://img.shields.io/badge/Grok-444444?style=flat-square)](https://x.ai)

終端編程智慧體。單一 binary `ccb`。同一個 agent loop 對接 Anthropic（OAuth 或 API key）、Anthropic 相容端點、ChatGPT Codex（OAuth）、OpenAI 相容端點（Ollama、DeepSeek、vLLM、xAI Grok……）、Gemini。支援 macOS、Linux、Windows。

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

---

## 快速上手

開啟終端機 — **macOS** 按 `⌘ Space`，輸入 `Terminal`，按 Enter。**Linux** 按 `Ctrl Alt T`。**Windows** 從開始功能表開啟 **PowerShell**。

接著執行：

```bash
ccb
```

這會進入互動式 REPL。用中文或英文輸入任務，按 `Enter` 送出：

```
> 把 auth 模組重構成 async/await
> 解釋這個專案在做什麼
> 幫 src/utils/parser.ts 寫測試
```

**一次性模式**（不進 REPL，直接輸出結果）：

```bash
ccb -p "package.json 是在做什麼？"
```

**繼續上一次的對話：**

```bash
ccb --continue
```

**REPL 內快捷鍵：**

| 按鍵 | 動作 |
|------|------|
| `Enter` | 送出訊息 |
| `Shift+Enter` | 換行 |
| `Escape` | 中止目前回應 |
| `/help` | 顯示所有指令 |
| `Ctrl+C` | 離開 |

> 不支援 Windows ARM64，請在 x64 模擬下執行，或改走 WSL。

---

## 10 分鐘上手 ccb — `/powerup`

新手？在 REPL 中輸入：

```
/powerup
```

10 個短小的互動課程，帶你逐一體驗 ccb 真正值得用的功能 — `@` 檔案提及、權限模式、`/rewind` 與 Esc-Esc 還原、背景 session、CLAUDE.md、MCP、Skills 與 hooks、`/fork` 平行分支、模型調節、多 provider 切換。打開一條、試一試、標記完成。首頁 banner 會持續顯示進度直到 10 條全部解鎖。

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

## 解除安裝

```bash
# macOS / Linux
rm -rf ~/.local/share/ccb ~/.local/bin/ccb

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\ccb"
```

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [Anthropic 官方 Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
