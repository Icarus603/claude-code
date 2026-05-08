# Claude Code Best

[English](./README.md) | [繁體中文](./README.zh-TW.md)

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

终端编程智能体。单一 binary `ccb`。同一个 agent loop 对接 Anthropic（OAuth 或 API key）、Anthropic 兼容端点、ChatGPT Codex（OAuth）、OpenAI 兼容端点（Ollama、DeepSeek、vLLM、xAI Grok……）、Gemini。支持 macOS、Linux、Windows。

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

---

## 快速上手

打开终端 — **macOS** 按 `⌘ Space`，输入 `Terminal`，回车。**Linux** 按 `Ctrl Alt T`。**Windows** 从开始菜单打开 **PowerShell**。

然后执行：

```bash
ccb
```

这会进入交互式 REPL。用中文或英文输入任务，按 `Enter` 发送：

```
> 把 auth 模块重构成 async/await
> 解释这个项目在做什么
> 帮 src/utils/parser.ts 写测试
```

**一次性模式**（不进 REPL，直接输出结果）：

```bash
ccb -p "package.json 是做什么的？"
```

**继续上一次的对话：**

```bash
ccb --continue
```

**REPL 内快捷键：**

| 按键 | 动作 |
|------|------|
| `Enter` | 发送消息 |
| `Shift+Enter` | 换行 |
| `Escape` | 中止当前响应 |
| `/help` | 显示所有命令 |
| `Ctrl+C` | 退出 |

> 不支持 Windows ARM64，请在 x64 模拟下运行，或改走 WSL。

---

## 10 分钟上手 ccb — `/powerup`

新手？在 REPL 中输入：

```
/powerup
```

10 个短小的互动课程，带你逐一体验 ccb 真正值得用的功能 — `@` 文件提及、权限模式、`/rewind` 与 Esc-Esc 还原、后台 session、CLAUDE.md、MCP、Skills 与 hooks、`/fork` 并行分支、模型调节、多 provider 切换。打开一条、试一试、标记完成。首页 banner 会持续显示进度直到 10 条全部解锁。

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

## 卸载

```bash
# macOS / Linux
rm -rf ~/.local/share/ccb ~/.local/bin/ccb

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\ccb"
```

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [Anthropic 官方 Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
