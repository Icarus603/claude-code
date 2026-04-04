# Auto Dream — 自动记忆整理

## 概述

Auto Dream 是 Claude Code 的后台记忆整合机制。它在会话间自动审查、组织和修剪持久化记忆文件，确保未来会话能快速获得准确的上下文。

记忆系统存储在文件系统中（默认 `~/.claude/projects/<project-slug>/memory/`），由 `MEMORY.md` 索引文件和若干主题文件（如 `user_language.md`、`project_overview.md`）组成。随着会话积累，记忆会变得过时、冗余或矛盾——Dream 负责清理这些堆积。

## 架构

### 核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| 调度器 | `src/services/autoDream/autoDream.ts` | 时间/会话/锁三重门控，触发 forked agent |
| 配置 | `src/services/autoDream/config.ts` | 读取 `isAutoDreamEnabled()` 开关 |
| 提示词 | `src/services/autoDream/consolidationPrompt.ts` | 构建 4 阶段整理提示词 |
| 锁文件 | `src/services/autoDream/consolidationLock.ts` | PID 锁 + mtime 作为 `lastConsolidatedAt` |
| 任务 UI | `src/tasks/DreamTask/DreamTask.ts` | 后台任务注册，footer pill + Shift+Down 可见 |
| 手动入口 | `src/skills/bundled/dream.ts` | `/dream` 命令，无条件可用 |

### 记忆路径解析

优先级（`src/memdir/paths.ts`）：

1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` 环境变量（完整路径覆盖）
2. `autoMemoryDirectory` 设置项（`settings.json`，支持 `~/` 展开）
3. 默认：`<memoryBase>/projects/<sanitized-git-root>/memory/`

其中 `memoryBase` = `CLAUDE_CODE_REMOTE_MEMORY_DIR` 或 `~/.claude`。

## 触发机制

### 自动触发（Auto Dream）

每个对话轮次结束后，`executeAutoDream()` 按顺序检查三重门控：

```
┌─────────────────────────────────────────────────────┐
│  Gate 1: 全局开关                                     │
│  isAutoMemoryEnabled() && isAutoDreamEnabled()       │
│  排除: KAIROS 模式 / Remote 模式                      │
├─────────────────────────────────────────────────────┤
│  Gate 2: 时间门控                                     │
│  hoursSince(lastConsolidatedAt) >= minHours          │
│  默认: 24 小时                                        │
├─────────────────────────────────────────────────────┤
│  Gate 3: 会话门控                                     │
│  sessionsTouchedSince(lastConsolidatedAt) >= minSessions │
│  默认: 5 个会话（排除当前会话）                         │
├─────────────────────────────────────────────────────┤
│  Lock: PID 锁文件                                     │
│  .consolidate-lock (mtime = lastConsolidatedAt)      │
│  死进程检测 + 1 小时过期                               │
└─────────────────────────────────────────────────────┘
```

全部通过后，以 **forked agent**（受限子代理）方式运行整理任务：

- Bash 工具限制为只读命令（`ls`、`grep`、`cat` 等）
- 只能读写记忆目录内的文件
- 用户可在 Shift+Down 后台任务面板中查看进度或终止

### 手动触发（`/dream` 命令）

通过 `/dream` 命令随时触发，无门控限制：

- 在主循环中运行（非 forked agent），拥有完整工具权限
- 用户可实时观察操作过程
- 执行前自动更新锁文件 mtime

### 配置开关

| 开关 | 位置 | 作用 |
|------|------|------|
| `autoDreamEnabled` | `settings.json` | `true`/`false` 显式开关 |
| `autoMemoryEnabled` | `settings.json` | 总开关，关闭后所有记忆功能禁用 |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | 环境变量 | `1`/`true` 关闭所有记忆功能 |
| `tengu_onyx_plover` | GrowthBook | 官方远程配置，控制 `enabled`/`minHours`/`minSessions` |

默认值（无 GrowthBook 连接时）：

```typescript
minHours: 24      // 距上次整理至少 24 小时
minSessions: 5    // 至少有 5 个新会话
```

## 整理流程（4 阶段）

Dream agent 执行的提示词包含 4 个阶段：

### Phase 1 — 定位（Orient）

- `ls` 记忆目录，查看现有文件
- 读取 `MEMORY.md` 索引
- 浏览现有主题文件，避免重复创建

### Phase 2 — 采集信号（Gather）

按优先级收集新信息：

1. **日志文件**（`logs/YYYY/MM/YYYY-MM-DD.md`，KAIROS 模式下的追加式日志）
2. **过时记忆** — 与当前代码库状态矛盾的事实
3. **会话记录** — 窄关键词 grep JSONL 文件（不全文读取）

### Phase 3 — 整合（Consolidate）

- 合并新信号到现有主题文件，而非创建近似重复
- 将相对日期（"昨天"、"上周"）转为绝对日期
- 删除被推翻的事实

### Phase 4 — 修剪与索引（Prune）

- `MEMORY.md` 保持在 200 行以内、25KB 以内
- 每条索引项一行，不超过 150 字符
- 移除过时/错误/被取代的指针

## 记忆类型

记忆系统使用 4 种类型（`src/memdir/memoryTypes.ts`）：

| 类型 | 用途 | 示例 |
|------|------|------|
| `user` | 用户角色、偏好、知识 | 用户是高级后端工程师，偏好中文交流 |
| `feedback` | 工作方式指导 | 不要 mock 数据库测试；代码审查用 bundled PR |
| `project` | 项目上下文（非代码可推导的） | 合并冻结从 3 月 5 日开始；认证重写是合规需求 |
| `reference` | 外部系统指针 | Linear INGEST 项目跟踪 pipeline bugs |

**不保存的内容**：代码模式、架构、文件路径（可从代码推导）；Git 历史（`git log` 权威）；调试方案（代码中已有）。

## 锁文件机制

`.consolidate-lock` 文件位于记忆目录内：

- **文件内容**：持有者 PID
- **mtime**：即 `lastConsolidatedAt` 时间戳
- **过期**：1 小时（防 PID 复用）
- **竞态处理**：双进程同时写入时，后读验证 PID，失败者退出
- **回滚**：forked agent 失败或被用户终止时，mtime 回退到获取前的值

## 使用场景

### 场景 1：日常开发中的自动整理

开发者连续多天使用 Claude Code 处理不同任务。Auto Dream 在积累 5+ 个会话且距上次整理 24 小时后自动触发，整合分散在多次会话中的用户偏好和项目决策。

### 场景 2：手动整理记忆

用户发现 Claude 重复犯相同错误或遗忘之前的决策。输入 `/dream` 立即触发整理，无需等待自动触发周期。

### 场景 3：新会话快速上下文

新会话启动时，`MEMORY.md` 被加载到上下文中。经过 Dream 整理的记忆文件结构清晰、信息准确，让 Claude 快速了解用户和项目。

### 场景 4：KAIROS 模式下的日志蒸馏

KAIROS（长驻助手模式）中，agent 以追加方式写入日期日志文件。Dream 负责将这些日志蒸馏为主题文件和 `MEMORY.md` 索引。

## 与其他系统的关系

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│ 会话交互     │────▶│ 记忆写入      │────▶│ MEMORY.md     │
│ (主 agent)  │     │ (即时保存)    │     │ + 主题文件     │
└─────────────┘     └──────────────┘     └───────┬───────┘
                                               │
       ┌───────────────────────────────────────┘
       ▼
┌──────────────┐     ┌──────────────┐
│ Auto Dream   │────▶│ 整理/修剪    │
│ (后台触发)   │     │ 去重/纠错    │
└──────────────┘     └──────────────┘
       ▲
┌──────────────┐
│ /dream 命令  │
│ (手动触发)   │
└──────────────┘
```

- **extractMemories**（`src/services/extractMemories/`）：每轮次结束时从对话中提取新记忆并写入。Dream 不负责提取，只负责整理。
- **CLAUDE.md**：项目级指令文件，加载到上下文中但不属于记忆系统。
- **Team Memory**（`TEAMMEM` feature）：团队共享记忆目录，与个人记忆使用相同的 Dream 机制。
