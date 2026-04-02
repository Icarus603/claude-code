# Claude Code 源码学习路线

> 基于反编译版 Claude Code CLI (v2.1.888) 的源码学习跟踪
>
> 各阶段详细笔记见同目录下的 `phase-*.md` 文件

## 第一阶段：启动流程（入口链路） ✅

详细笔记：[phase-1-startup-flow.md](phase-1-startup-flow.md)

理解程序从命令行启动到用户看到交互界面的完整路径。

- [x] `src/entrypoints/cli.tsx` — 真正入口，polyfill 注入 + 快速路径分发
  - [x] 全局 polyfill：`feature()` 永远返回 false、`MACRO` 全局对象、`BUILD_*` 常量
  - [x] 快速路径设计：按开销从低到高检查，能早返回就早返回
  - [x] 动态 import 模式：`await import()` 延迟加载，减少启动时间
  - [x] 最终出口：`import("../main.jsx")` → `cliMain()`
- [x] `src/main.tsx` — Commander.js CLI 定义，重型初始化（4683 行）
  - [x] 三段式结构：辅助函数(1-584) → main()(585-856) → run()(884-4683)
  - [x] side-effect import：profileCheckpoint、startMdmRawRead、startKeychainPrefetch 并行预加载
  - [x] preAction 钩子：MDM 等待、init()、迁移、远程设置
  - [x] Commander 参数定义：40+ CLI 选项
  - [x] action handler（2800 行）：参数解析 → 服务初始化 → showSetupScreens → launchRepl()
  - [x] --print 分支走 print.ts；交互分支走 launchRepl()（7 个场景分支）
  - [x] 子命令注册：mcp/auth/plugin/doctor/update/install 等
- [x] `src/replLauncher.tsx` — 桥梁（22 行），组合 `<App>` + `<REPL>` 渲染到终端
- [x] `src/screens/REPL.tsx` — 交互式 REPL 界面（5009 行）
  - [x] Props：commands、tools、messages、systemPrompt、thinkingConfig 等
  - [x] 50+ 状态：messages、inputValue、screen、streamingText、queryGuard 等
  - [x] 核心数据流：onSubmit → handlePromptSubmit → onQuery → onQueryImpl → query() → onQueryEvent
  - [x] QueryGuard 并发控制：idle → running → idle，防止重复查询
  - [x] 渲染：Transcript 模式（只读历史）/ Prompt 模式（Messages + PermissionRequest + PromptInput）

**数据流**：`bun run dev` → `package.json scripts.dev` → `bun run src/entrypoints/cli.tsx` → 快速路径检查 → `main.tsx:main()` → `launchRepl()` → `<App><REPL /></App>`

---

## 第二阶段：核心对话循环 ✅

详细笔记：[phase-2-conversation-loop.md](phase-2-conversation-loop.md)

理解用户发一句话后，如何变成 API 请求、如何处理流式响应和工具调用。

- [x] `src/query.ts` — 核心查询循环（1732 行）
  - [x] `query()` AsyncGenerator 入口，委托给 `queryLoop()`
  - [x] `queryLoop()` — while(true) 主循环，State 对象管理迭代状态
  - [x] 消息预处理（autocompact、compact boundary）
  - [x] `deps.callModel()` → 流式 API 调用
  - [x] StreamingToolExecutor — API 流式返回时并行执行工具
  - [x] 工具调用循环（tool use → 执行 → result → continue）
  - [x] 错误恢复（prompt-too-long、max_output_tokens 升级+多轮恢复）
  - [x] 模型降级（FallbackTriggeredError → 切换 fallbackModel）
  - [x] Withheld 消息模式（暂扣可恢复错误）
- [x] `src/QueryEngine.ts` — 高层编排器（1320 行）
  - [x] QueryEngine 类 — 一个 conversation 一个实例
  - [x] `submitMessage()` — 处理用户输入 → 调用 `query()` → 消费事件流
  - [x] SDK/print 模式专用（REPL 直接调用 query()）
  - [x] 会话持久化（recordTranscript）
  - [x] Usage 跟踪、权限拒绝记录
  - [x] `ask()` 便捷包装函数
- [x] `src/services/api/claude.ts` — API 客户端（3420 行）
  - [x] `queryModelWithStreaming` / `queryModelWithoutStreaming` — 两个公开入口
  - [x] `queryModel()` — 核心私有函数（2400 行）
  - [x] 请求参数组装（system prompt、betas、tools、cache control）
  - [x] Anthropic SDK 流式调用（`anthropic.beta.messages.stream()`）
  - [x] `BetaRawMessageStreamEvent` 事件处理（message_start/content_block_*/message_delta/stop）
  - [x] withRetry 重试策略（429/500/529 + 模型降级）
  - [x] Prompt Caching 策略（ephemeral/1h TTL/global scope）
  - [x] 多 provider 支持（Anthropic / Bedrock / Vertex / Azure）

**数据流**：REPL.onSubmit → handlePromptSubmit → onQuery → onQueryImpl → `query()` AsyncGenerator → `queryLoop()` while(true) → `deps.callModel()` → `claude.ts queryModel()` → `anthropic.beta.messages.stream()` → 流式事件 → 收集 tool_use → 执行工具 → 结果追加到 messages → continue → 无工具调用时 return

---

## 第三阶段：工具系统

理解 Claude 如何定义、注册、调用工具。先读框架，再挑具体工具。

- [ ] `src/Tool.ts` — Tool 接口定义
  - [ ] `Tool` 类型结构（name、description、inputSchema、call）
  - [ ] `findToolByName`、`toolMatchesName` 工具函数
- [ ] `src/tools.ts` — 工具注册表
  - [ ] 工具列表组装逻辑
  - [ ] 条件加载（feature flag、USER_TYPE）
- [ ] 具体工具实现（挑选 2-3 个深入阅读）：
  - [ ] `src/tools/BashTool/` — 执行 shell 命令，最常用的工具
  - [ ] `src/tools/FileReadTool/` — 读取文件，简单直观，适合理解工具模式
  - [ ] `src/tools/FileEditTool/` — 编辑文件，理解 diff/patch 机制
  - [ ] `src/tools/AgentTool/` — 子 Agent 机制，较复杂但核心

---

## 第四阶段：上下文与系统提示

理解 Claude 如何"知道"项目信息、用户偏好等上下文。

- [ ] `src/context.ts` — 系统/用户上下文构建
  - [ ] git 状态注入
  - [ ] CLAUDE.md 内容加载
  - [ ] 内存文件（memory）注入
  - [ ] 日期、平台等环境信息
- [ ] `src/utils/claudemd.ts` — CLAUDE.md 发现与加载
  - [ ] 项目层级搜索逻辑
  - [ ] 多级 CLAUDE.md 合并

---

## 第五阶段：UI 层（按兴趣选读）

理解终端 UI 的渲染机制（React/Ink）。

- [ ] `src/components/App.tsx` — 根组件，Provider 注入
- [ ] `src/state/AppState.tsx` — 全局状态类型与 Context
- [ ] `src/components/permissions/` — 工具权限审批 UI
- [ ] `src/components/messages/` — 消息渲染组件

---

## 第六阶段：外围系统（按需探索）

- [ ] `src/services/mcp/` — MCP 协议（Model Context Protocol）
- [ ] `src/skills/` — 技能系统（/commit 等斜杠命令）
- [ ] `src/commands/` — CLI 子命令
- [ ] `src/tasks/` — 后台任务系统
- [ ] `src/utils/model/providers.ts` — 多 provider 选择逻辑

---

## 学习笔记

### 关键设计模式

| 模式 | 位置 | 说明 |
|------|------|------|
| 快速路径 | cli.tsx | 按开销从低到高逐级检查，减少不必要的模块加载 |
| 动态 import | cli.tsx / main.tsx | `await import()` 延迟加载，优化启动时间 |
| feature flag | 全局 | `feature()` 永远返回 false，所有内部功能禁用 |
| React/Ink | UI 层 | 用 React 组件模型渲染终端 UI |
| 工具循环 | query.ts | AI 返回工具调用 → 执行 → 结果回传 → 继续，直到无工具调用 |
| AsyncGenerator 链 | query.ts → claude.ts | `yield*` 透传事件流，形成管道 |
| State 对象 | query.ts queryLoop | 循环间通过不可变 State + transition 字段传递状态 |
| StreamingToolExecutor | query.ts | API 流式返回时并行执行工具 |
| Withheld 消息 | query.ts | 暂扣可恢复错误，恢复成功则吞掉 |
| withRetry | claude.ts | 429/500/529 自动重试 + 模型降级 |
| Prompt Caching | claude.ts | 缓存系统提示和历史消息，减少 token 消耗 |

### 需要忽略的内容

- `_c()` 调用 — React Compiler 反编译产物
- `feature('...')` 后面的代码块 — 全部是死代码
- tsc 类型错误 — 反编译导致，不影响 Bun 运行
- `packages/@ant/` — stub 包，无实际实现