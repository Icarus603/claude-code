# Feature Flags 审查报告 — Codex 复核

> 审查日期: 2026-04-05
> 审查工具: Codex CLI v0.118.0 (本地, full-auto mode)
> 消耗 tokens: 240,306
> 审查范围: docs/feature-flags-audit-complete.md 中标记为 COMPLETE 的 22 个编译时 feature flag

---

## 审查背景

原始审计报告 (`docs/feature-flags-audit-complete.md`) 声称 22 个 feature flag 被标记为 "COMPLETE"，只需在 `build.ts` / `scripts/dev.ts` 中启用即可工作。

Claude Code 团队通过 6 个并行子代理实际读取源码后初步发现大量误判，随后将分析结果传递给 Codex CLI 进行独立二次验证。

---

## Codex 发现摘要

### High 级发现

1. **`CONTEXT_COLLAPSE` 不是 COMPLETE**
   - `src/services/contextCollapse/index.ts:43` — `isContextCollapseEnabled()` 硬编码为 `false`
   - `src/services/contextCollapse/index.ts:47` — `applyCollapsesIfNeeded()` 只是原样返回消息
   - `src/services/contextCollapse/index.ts:59` — `recoverFromOverflow()` 也是 no-op
   - `src/services/contextCollapse/operations.ts:3` 和 `persist.ts:3` 同样是 stub
   - 审计报告把 UI/命令文件算进去了，但真正被查询循环消费的是 stub 后端

2. **原分类"真正只需编译开关"的 7 个 flag，只有 3 个准确**
   - ✅ `SHOT_STATS` — 零额外门控，compile-only
   - ✅ `PROMPT_CACHE_BREAK_DETECTION` — 有 try-catch 兜底，compile-only
   - ✅ `TOKEN_BUDGET` — 纯本地计算，compile-only
   - ❌ `TEAMMEM` — 还要求 AutoMem + GrowthBook `tengu_herring_clock` + GitHub repo (`teamMemPaths.ts:73`, `watcher.ts:256`, `watcher.ts:259`)
   - ❌ `AGENT_TRIGGERS` — 受 `isKairosCronEnabled()` GrowthBook 控制 (`useScheduledTasks.ts:61`, `useScheduledTasks.ts:119`)
   - ❌ `EXTRACT_MEMORIES` — 受 `tengu_passport_quail` + AutoMem + 非 remote 限制 (`extractMemories.ts:536`, `:545`, `:550`)
   - ❌ `KAIROS_BRIEF` — 受 `tengu_kairos_brief` + opt-in/kairosActive 限制 (`BriefTool.ts:95`, `:126`, `:132`)

### Medium 级发现

3. **`BG_SESSIONS` 和 `BASH_CLASSIFIER` 不适合简单归为"全 stub"**
   - `BG_SESSIONS` — 会话注册/清理是真实现 (`concurrentSessions.ts:44`, `:55`)，但任务摘要核心是 stub (`taskSummary.ts:2`)
   - `BASH_CLASSIFIER` — 权限编排很大一块是真实现 (`bashPermissions.ts` 2621行)，但分类后端 `bashClassifier.ts:24` 永远返回 disabled

4. **审计口径问题**
   - 把"代码量/周边 UI 很多"误当成"可独立启用"
   - `PROACTIVE` — `index.ts:3` 只有 state stub，`commands.ts:64` 和 `REPL.tsx:415` 引用缺失文件
   - `REACTIVE_COMPACT` — `reactiveCompact.ts:13` 整块是 stub
   - `CACHED_MICROCOMPACT` — `cachedMicrocompact.ts:22` 全部 stub

---

## Codex 修正后的分类

### 第一类：真正 compile-only（3 个）

| Flag | 说明 | Crash 风险 |
|------|------|-----------|
| **SHOT_STATS** | 纯本地 shot 分布统计，ant-only 数据路径 | 低 |
| **PROMPT_CACHE_BREAK_DETECTION** | 本地 cache key 变化检测，写 diff 有兜底 | 低 |
| **TOKEN_BUDGET** | 本地 token 预算追踪，纯计算逻辑 | 低 |

### 第二类：compile + 运行时条件（7 个）

| Flag | 条件 | Crash 风险 |
|------|------|-----------|
| **TEAMMEM** | AutoMem + GrowthBook `tengu_herring_clock` + GitHub repo | 低 (clean no-op) |
| **AGENT_TRIGGERS** | GrowthBook `isKairosCronEnabled()` | 低 (clean no-op) |
| **EXTRACT_MEMORIES** | `tengu_passport_quail` + AutoMem + 非 remote | 低 (clean no-op) |
| **KAIROS_BRIEF** | `tengu_kairos_brief` + opt-in/kairosActive，可用 `CLAUDE_CODE_BRIEF=1` 绕过 | 低 |
| **COORDINATOR_MODE** | 需 `CLAUDE_CODE_COORDINATOR_MODE=1`，`workerAgent.ts` 是 stub 但不阻塞 | 低 |
| **COMMIT_ATTRIBUTION** | 仅对 `isInternal=true` 的 repo 生效 | 低 |
| **VERIFICATION_AGENT** | 受 GrowthBook `tengu_hive_evidence` 双重门控 | 低 |

### 第三类：混合型 — 部分实现 + stub 核心（5 个）

| Flag | 真实现部分 | Stub 核心 |
|------|-----------|----------|
| **BG_SESSIONS** | 会话注册/清理 (`concurrentSessions.ts`) | `bg.ts`/`taskSummary.ts`/`udsClient.ts` 全 stub + 依赖 tmux |
| **BASH_CLASSIFIER** | 权限编排 (`bashPermissions.ts` 2621行) | `bashClassifier.ts` 分类后端 stub + 需 API beta |
| **PROACTIVE** | REPL/命令注册框架 | `index.ts` stub + 3 文件缺失 |
| **REACTIVE_COMPACT** | 调用点已在主查询环路 | `reactiveCompact.ts` 22行全 no-op |
| **CACHED_MICROCOMPACT** | 调用点已布线 | `cachedMicrocompact.ts` 全 stub + 需未公开 API |

### 第四类：纯 stub（1 个）

| Flag | 问题 |
|------|------|
| **CONTEXT_COLLAPSE** | 3 核心文件全 stub + CtxInspectTool 目录不存在 |

### 第五类：依赖远程服务（3 个）

| Flag | 依赖 |
|------|------|
| **ULTRAPLAN** | CCR 远程 agent 基础设施 + OAuth |
| **CCR_REMOTE_SETUP** | claude.ai OAuth + GitHub CLI + CCR 后端 |
| **BRIDGE_MODE** (build端) | claude.ai 订阅 + GrowthBook + WebSocket 后端 |

---

## 第三类恢复优先级建议

Codex 推荐的恢复顺序：

1. **REACTIVE_COMPACT** — 收益最直接，调用点在主查询环路，改完最容易立刻见效
2. **BG_SESSIONS** — 已有会话注册基础，补齐摘要和后台运行链路的 ROI 高
3. **PROACTIVE** — 产品面大，但缺文件比 stub 更严重，范围比前两项大
4. **CONTEXT_COLLAPSE** — collapse engine 全 stub，恢复成本和设计不确定性都高
5. **BASH_CLASSIFIER** — 若无 API beta 能力不值得优先；若有则升到第 2
6. **CACHED_MICROCOMPACT** — 受未公开 API 约束，最后做

---

## 审计报告分类标准修正建议

Codex 建议将原来的单轴分类（COMPLETE/PARTIAL/STUB）改为**三轴**：

| 轴 | 取值 | 说明 |
|----|------|------|
| **实现完整度** | `full` / `mixed` / `stub` | 活跃调用链上的核心模块是否有真实现 |
| **激活条件** | `compile-only` / `compile+env` / `compile+GrowthBook` / `compile+remote` / `compile+private API` | 启用需要什么 |
| **运行风险** | `safe no-op` / `background IO` / `startup critical` | 启用后条件不满足时的行为 |

**COMPLETE 的最低标准应满足：**
1. 活跃调用链上的核心模块不能是 stub
2. "可启用"不能只看编译 flag，还要单列运行时 gate

按此标准，`CONTEXT_COLLAPSE`、`BG_SESSIONS`、`BASH_CLASSIFIER`、`PROACTIVE`、`REACTIVE_COMPACT`、`CACHED_MICROCOMPACT` 都应从 COMPLETE 降级。

---

## 已采取的行动

基于审查结果，已将以下 3 个确认安全的 flag 加入默认构建：

**build.ts:**
```typescript
const DEFAULT_BUILD_FEATURES = [
  "AGENT_TRIGGERS_REMOTE", "CHICAGO_MCP", "VOICE_MODE",
  "SHOT_STATS", "PROMPT_CACHE_BREAK_DETECTION", "TOKEN_BUDGET"
];
```

**scripts/dev.ts:**
```typescript
const DEFAULT_FEATURES = [
  "BUDDY", "TRANSCRIPT_CLASSIFIER", "BRIDGE_MODE",
  "AGENT_TRIGGERS_REMOTE", "CHICAGO_MCP", "VOICE_MODE",
  "SHOT_STATS", "PROMPT_CACHE_BREAK_DETECTION", "TOKEN_BUDGET"
];
```

### 验证结果

| 项目 | 结果 |
|------|------|
| `bun run build` | ✅ 成功 (475 files) |
| `bun test` | ✅ 无新增失败 (23 fail 为已有问题) |
| SHOT_STATS 代码路径 | ✅ 完整 — stats 面板显示 shot 分布 |
| TOKEN_BUDGET 代码路径 | ✅ 完整 — 支持 `+500k` 语法，带进度条 |
| PROMPT_CACHE_BREAK_DETECTION 代码路径 | ✅ 完整 — 内部诊断，debug 模式可见 |
