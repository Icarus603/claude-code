# Claude Code Best

[English](./README.md) | [繁體中文](./README.zh-TW.md)

[![Release](https://img.shields.io/github/v/release/Icarus603/claude-code?style=flat&color=80BDFF&label=ccb)](https://github.com/Icarus603/claude-code/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Icarus603/claude-code/ci.yml?branch=main&style=flat&label=ci)](https://github.com/Icarus603/claude-code/actions/workflows/ci.yml)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=flat&color=7C3AED&label=updated)](https://github.com/Icarus603/claude-code/commits/main)
[![Stars](https://img.shields.io/github/stars/Icarus603/claude-code?style=flat&color=D4A017)](https://github.com/Icarus603/claude-code/stargazers)
[![Platforms](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-1F4E8C?style=flat)](https://github.com/Icarus603/claude-code/releases/latest)
[![Bun](https://img.shields.io/badge/runtime-bun-F9F1E1?style=flat&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://github.com/Icarus603/claude-code)

[![Models](https://img.shields.io/badge/%E6%A8%A1%E5%9E%8B-722F37?style=flat)](#install)
[![Claude Subscription](https://img.shields.io/badge/Claude%20Subscription-D97757?style=flat&logo=claude&logoColor=fff)](https://claude.ai/upgrade)
[![Anthropic API](https://img.shields.io/badge/Anthropic%20API-191919?style=flat&logo=anthropic&logoColor=fff)](https://console.anthropic.com)
[![Anthropic Compatible](https://img.shields.io/badge/Anthropic%20Compatible-CC785C?style=flat&logo=anthropic&logoColor=fff)](https://docs.anthropic.com/en/api)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI%20Compatible-10A37F?style=flat)](https://platform.openai.com/docs/api-reference/chat)
[![ChatGPT Codex](https://img.shields.io/badge/ChatGPT%20Codex-0E7C5E?style=flat)](https://openai.com/codex)
[![Gemini](https://img.shields.io/badge/Gemini-4285F4?style=flat&logo=googlegemini&logoColor=fff)](https://ai.google.dev)

终端编程智能体。单一 binary `ccb`。同一个 agent loop 对接 Anthropic（OAuth 或 API key）、Anthropic 兼容端点、ChatGPT Codex（OAuth）、OpenAI 兼容端点（Ollama、DeepSeek、vLLM……）、Gemini。支持 macOS、Linux、Windows。

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

## 记忆整理 — `/dream`

<p align="center">
  <img src="assets/dream-demo.gif" alt="ccb /dream 命令演示" width="100%">
</p>

ccb 在 `~/.claude/projects/<project>/memory/` 维护一套持久化、以文件为基础的记忆 — 一个 `MEMORY.md` 索引加上分型主题文件（`user`、`feedback`、`project`、`reference`）。它在工作过程中实时写入这些文件，让新 session 能快速进入状态。经过多次 session 之后，这些文件会漂移：条目过时、彼此重复、或与当前代码矛盾。`/dream` 就是负责清理它们的反思流程。

在 REPL 中输入：

```
/dream
```

它会**立刻在前台执行，拥有完整工具权限**，全程让你看着。模型会对记忆目录做四阶段整理：

1. **定位（Orient）** — `ls` 记忆目录、读 `MEMORY.md`、浏览主题文件与最近的 session 日志，以便改进而非重复建立。
2. **采集（Gather）** — 从 session 日志与 transcript（窄关键词 grep，从不全文读取）收集新信号，并标出与代码漂移的记忆。
3. **整合（Consolidate）** — 把新信号并入既有文件、把相对日期转成绝对日期、删除被推翻的事实。
4. **修剪与索引（Prune & index）** — 让 `MEMORY.md` 保持索引形态（每条一行、200 行 / ~25 KB 以内）、移除被取代的指针、与 `CLAUDE.md` 对账。

完成后你会拿到一份简短摘要，说明整理、更新或修剪了什么。

### 三种模式

| 命令 | 作用 |
|------|------|
| `/dream` | 立刻整理 — 前台、完整工具、你在旁边看。可在后面接文字当额外上下文（例如 `/dream 聚焦在 auth 重构`）。 |
| `/dream nightly` | 排程每晚自动整理。安装一个 `durable`、`recurring` 的 cron，在本地时间 00:00–05:59 之间随机某分钟触发 `/dream consolidate`（加 jitter 避免多 session 同时涌入）。排程写入 `.claude/scheduled_tasks.json`，跨 session 持久。 |
| `/dream consolidate` | 不带手动模式前言的纯整理本体 — 就是每晚 cron 触发的内容。也可以手动执行。 |

`/dream` 另有别名 `/learn`。

### 每晚排程注意事项

- 周期性任务在 **7 天后自动过期** — 重跑 `/dream nightly` 即可续期。（重跑也会去重：排新的之前先删掉既有的 `/dream consolidate` 任务。）
- 随时取消 — 用 cron 工具列出任务并按 ID 删除，或在 `/memory` 切换 **Auto-dream** 那一行。
- 需要 auto-memory 开启。remote 模式下、以及 auto-memory 关闭时，此命令会隐藏。

---

## 周期与自定步调任务 — `/loop`

`/loop` 把任何 prompt 或 slash command 变成重复执行的任务。两种跑法：固定间隔，或完全不给间隔 — 后者由模型根据上一轮看到的状况自己决定下次等多久。

在 REPL 中：

```
/loop 5m /babysit-prs        # 每 5 分钟跑一次 /babysit-prs
/loop 30m check the deploy   # 每 30 分钟跑一个纯 prompt
/loop check the deploy       # 不给间隔 → 模型自定步调
/loop                        # 裸跑 → 自主检查，动态调步
```

间隔取自开头 token（`5m`、`2h`、`1d`）或结尾的 `every …` 子句（`check the deploy every 20m`、`run tests every 5 minutes`）。最小粒度 1 分钟。`/loop` 会**立刻**跑一次任务，再排下一次触发 — 不用等第一个 tick。

| 形式 | 行为 |
|------|------|
| `/loop <间隔> <prompt>` | 固定节奏。把间隔转成 cron，周期性触发直到取消。 |
| `/loop <prompt>`（无间隔） | 动态模式 — 每跑完一次，模型依观察（通过 `ScheduleWakeup`）挑下次延迟：分支安静 → 等久一点，事情多 → 等短一点。 |
| `/loop`（裸跑） | 动态调步下的自主默认 — 现在先跑一次检查，之后自定步调。 |

`/loop` 另有别名 `/proactive`。

**注意事项**

- 周期性（固定间隔）任务在 **7 天后自动过期** — 重跑即可续期。动态模式的 loop 在模型不再排下次 wake-up 的那一刻停止。
- 用 `/cron-list` 列出任务、`/cron-delete <id>` 取消。
- 若某间隔无法干净表达成 cron（如 `7m`、`90m`），模型会 round 到最近的干净节奏并告诉你选了什么。
- 默认 GA。要在本地关掉整个 scheduler 用 `CLAUDE_CODE_DISABLE_CRON=1`。

---

## 代理视图 — `ccb agents`

<p align="center">
  <img src="assets/fleetview-demo.gif" alt="ccb 代理视图演示" width="100%">
</p>

一个用来统筹后台 session 的 TUI 仪表板。在终端输入：

```bash
ccb agents
```

即可看到所有后台 session 按状态分组（等待输入 · 进行中 · 已完成）实时列出，下方有 dispatch 输入框可以开新 session，还能用 peek 面板查看任一 session 的最近活动而不必 attach 进去。

**视图内快捷键：**

| 按键 | 动作 |
|------|------|
| 输入后 `Enter` | 派发一个新的后台 session 执行该任务 |
| `Shift+Enter` | dispatch 输入框换行 |
| `↑` / `↓` | 在 session 之间移动焦点 |
| `→` | Attach 进入焦点的 session |
| `Space` | Peek 焦点 session（不 attach 就能回复） |
| `Tab` | 切换 agents drawer / 接受候选 |
| `@name` / `/cmd` | 提及 agent、skill 或 repo |
| `Shift+↑` / `Shift+↓` | 在同一分组内重新排序 |
| `Ctrl+R` | 重命名焦点 session |
| `Ctrl+T` | 将焦点 session 钉到最上面 |
| `Ctrl+X` | 停止 / 删除焦点 session（两步确认） |
| `Ctrl+S` | 切换分组方式（按状态 ↔ 按目录） |
| `Ctrl+G` | 把 dispatch 输入框内容丢进 `$EDITOR` |
| 鼠标点击 | 点 row 切换焦点；点输入框可直接定位光标 |
| `?` | 打开视图内帮助 |
| `Esc` | 先清空输入，再按一次离开 |
| `Ctrl+C` | 两步确认离开（后台 session 不会被停） |

session 都是 PTY-backed 的，关掉终端之后依然存活 — 之后再 `ccb agents` 就能看到它们继续在跑。Dispatch 走 spare-worker pool，预热好的 worker 在线时新 session 几乎瞬间就能启动。

---

## Agent Teams — 协调多个 session

<p align="center">
  <img src="assets/swarm-demo.gif" alt="ccb Agent Teams swarm 演示" width="100%">
</p>

Agent Teams 让你协调数个 ccb instance 一起工作。一个 session 当 **team lead** — 它分派工作、整合结果、做协调。每个 **teammate** 都是一个完整、独立、有自己 context window 的 session，teammate 之间直接互传消息。跟普通 subagent（在单一 session 内跑、只能回报给主 agent）不同，你也可以直接跟任何 teammate 对话，不必经过 lead。

**你必须主动要求才会开 team — 它不会自己生成。** 用自然语言描述任务跟你想要的 team 形状，lead 就会把一切建好。ccb 也可能在察觉到可并行的工作时*主动提议*开 team，但一定先等你确认。无论哪种，没有你点头就不会 spawn。

```
> 用户报告 app 收到一条消息后就退出、没有保持连接。开一个 agent team：
  spawn 4 个 teammate 各查一个假设，让它们互相传消息去推翻彼此的理论，
  像一场科学辩论，最后把共识更新到 findings doc。
```

lead 会建一份共享 task list、spawn teammate、让它们认领并执行 task（blocker 完成后依赖自动解除），整合结果，做完后清理 team。在 REPL 里用 `Shift+Down` 在 teammate 间切换、直接对任一个传消息；或开 split pane（tmux / iTerm2）一次看到所有人。

### 何时用 team

当并行探索能带来真正价值、且 teammate 能各自独立工作时，team 最出色：

- **研究与 review** — 把一个 PR review 或 library 调查切成独立视角（security、performance、test coverage）同时跑。
- **新模块或新功能** — 每个 teammate 各拥一块，互不踩脚。
- **竞争假设式除错** — teammate 并行测试不同理论并辩论，胜过单一 agent 锁死在第一个看似合理的成因。
- **跨层协调** — 一个横跨 frontend、backend、tests 的改动，每层由不同 teammate 负责。

**何时别用：** team 带来协调开销、且烧的 token 显著更多（每个 teammate 是独立 session）。对于 sequential 工作、改同一个文件、或依赖很重的 task，单一 session 或 subagent 才是对的工具。第一次用 team？从研究或 review 开始 — 边界清楚、没有并行写入冲突。

### 诀窍

- **从 3–5 个 teammate 起步。** 再多，协调开销与 token 成本就盖过并行的好处；三个专注的 teammate 胜过五个散漫的。
- **沿文件边界切分。** 两个 teammate 改同一个文件会互相覆盖 — 给每个各自一组文件。
- **给每个 teammate 足够 context。** 它们跟一般 session 一样会载 `CLAUDE.md`、MCP、skills，但**不**继承 lead 的对话历史 — 把任务专属的细节放进 spawn prompt。
- **边跑边导。** 在某个 teammate 上按 Enter 读它的 session、按 Escape 中断它；该调整的方向就调整，别放着 team 无人看管乱跑。
- ccb 默认 GA — 无 env var、无 CLI flag（上游仍以 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 把它挡在实验阶段）。team 在 session 结束时自动清理。

---

## 工作流 — `ultrawork` 与 Workflow 工具

工作流是 ccb 的**确定性**多 agent 编排原语。Agent Team 是一群松散、对话式的 session；工作流则是一支 JavaScript 脚本，通过 `agent()` / `parallel()` / `pipeline()` / `phase()` 调用派生子 agent，在沙箱中于后台执行，并且可**续跑** —— 已完成的 agent 返回缓存结果，只有改动或新增的步骤才重跑。

**三种进入方式：**

1. **`ultrawork` 关键字。** 在提示中任意处输入 `ultrawork`，它会亮起彩虹微光（如同 `ultrathink` / `ultraplan`），并附带「将使用 Workflow 工具」提示。它引导模型把请求当成一个持续、被编排的工作单元，而非一次性回复。

   ```
   > ultrawork：把所有调用点从旧的 auth middleware 迁走，
     每个 package 一个子 agent，最后验证 build
   ```

2. **Workflow 工具**，由模型调用。它编译一支自足脚本并于后台启动：

   ```js
   export const meta = { name: 'audit', description: 'Per-package lint audit', phases: [] }
   const pkgs = ['cli', 'agent', 'repl']
   const results = await parallel(pkgs.map(p =>
     () => agent(`Lint-audit packages/${p} and report findings`)))
   log(results)
   ```

   脚本必须**确定性** —— `Date.now()`、`Math.random()`、`new Date()` 一律被拒，好让续跑能精确重现。上限：最多 1000 个子 agent、`min(16, cpus-2)` 并发、180 秒停滞检测、5 次重试。

3. **`/workflows`** —— 运行中与已完成工作流的历史浏览器（状态 · agent 数 · token · 时长）。`↑`/`↓` 选取、`Enter` 查看、`x` 停止运行中的工作流。

**注意事项**

- ccb **默认开启**（单人维护，与 `/goal` 同理）。本地以 `CLAUDE_CODE_WORKFLOWS=0` 关闭。上游把同一子系统挡在 opt-*in* 的 `CLAUDE_CODE_WORKFLOWS` env var 加服务器旗标之后；ccb 反转为 opt-*out*。
- 工作流内的子 agent 不能递归启动另一个工作流。
- 具名工作流（内建脚本 + `.claude/workflows/` 注册表）是规划中的后续工作 —— 目前请提供 inline `script` 或 `scriptPath`。

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
