# 第二阶段：核心对话循环详解

> 用户发一句话后，如何变成 API 请求、如何处理流式响应和工具调用

## 对话循环总览

```
用户输入 "帮我读取 README.md"
  │
  ▼
REPL.tsx: onSubmit → onQuery → onQueryImpl
  │
  ├── 1. 并行加载上下文:
  │     getSystemPrompt() + getUserContext() + getSystemContext()
  │
  ├── 2. buildEffectiveSystemPrompt() — 合成最终系统提示
  │
  ├── 3. for await (const event of query({...}))  ★ 核心循环
  │     │
  │     │  query.ts: queryLoop()
  │     │    ├── while (true) {
  │     │    │     ├── autocompact / microcompact 处理
  │     │    │     ├── deps.callModel() → claude.ts 流式 API 调用
  │     │    │     │     └── for await (message of stream) { yield message }
  │     │    │     │
  │     │    │     ├── 收集 assistant 消息中的 tool_use 块
  │     │    │     │
  │     │    │     ├── needsFollowUp?
  │     │    │     │     ├── true → 执行工具 → 收集结果 → state = next → continue
  │     │    │     │     └── false → 检查错误恢复 → return { reason: 'completed' }
  │     │    │     }
  │     │
  │     └── onQueryEvent(event) — 更新 UI 状态
  │
  └── 4. 收尾: resetLoadingState(), onTurnComplete()
```

### 两条数据路径

| 路径 | 调用方 | 说明 |
|------|--------|------|
| **交互式（REPL）** | REPL.tsx → `query()` | 直接调用 `query()` AsyncGenerator |
| **非交互式（SDK/print）** | print.ts → `QueryEngine.submitMessage()` → `query()` | 通过 QueryEngine 包装，增加了会话持久化、usage 跟踪等 |

---

## 1. query.ts（1732 行）— 核心查询循环

**文件路径**: `src/query.ts`

### 1.1 文件结构

```
query.ts (1732 行)
├── [0-120]      Import 区 + feature flag 条件模块加载
├── [122-148]    yieldMissingToolResultBlocks() — 为未配对的 tool_use 生成错误 tool_result
├── [150-178]    常量与辅助函数 (MAX_OUTPUT_TOKENS_RECOVERY_LIMIT, isWithheldMaxOutputTokens)
├── [180-198]    QueryParams 类型定义
├── [200-216]    State 类型 — 循环迭代间的可变状态
├── [218-238]    query() — 导出的 AsyncGenerator，委托给 queryLoop()
├── [240-1732]   queryLoop() — 核心 while(true) 循环
│   ├── [241-306]    初始化 State + 内存预取
│   ├── [307-448]    循环开头：解构 state、消息预处理（snip/microcompact/context collapse）
│   ├── [449-578]    系统提示构建(第449行) + autocompact(第453行) + StreamingToolExecutor 初始化(第562行)
│   ├── [650-866]    ★ deps.callModel()(第659行) + 流式响应处理 + tool_use 收集
│   ├── [896-956]    错误处理（FallbackTriggeredError、通用错误）
│   ├── [1002-1054]  中断处理（abortController.signal.aborted）
│   ├── [1065-1360]  无 followUp 时的终止/恢复逻辑
│   │   ├── prompt-too-long 恢复
│   │   ├── max_output_tokens 恢复（升级 + 多轮）
│   │   ├── stop hooks 执行
│   │   └── return { reason: 'completed' }
│   └── [1360-1732]  有 followUp 时的工具执行 + 下一轮准备
│       ├── 工具执行（streaming 或 sequential）
│       ├── attachment 注入（排队命令、内存预取、技能发现）
│       ├── maxTurns 检查
│       └── state = next → continue
```

### 1.2 入口：query() 函数（第 219 行）

```ts
export async function* query(params: QueryParams):
  AsyncGenerator<StreamEvent | Message | ..., Terminal> {
  const consumedCommandUuids: string[] = []
  const terminal = yield* queryLoop(params, consumedCommandUuids)
  // 通知所有消费的排队命令已完成
  for (const uuid of consumedCommandUuids) {
    notifyCommandLifecycle(uuid, 'completed')
  }
  return terminal
}
```

`query()` 本身很薄，只做两件事：
1. 委托给 `queryLoop()` 执行实际逻辑
2. 在正常返回后通知排队命令的生命周期

### 1.3 QueryParams（第 181 行）

```ts
type QueryParams = {
  messages: Message[]           // 当前对话消息
  systemPrompt: SystemPrompt    // 系统提示
  userContext: { [k: string]: string }  // 用户上下文（CLAUDE.md 等）
  systemContext: { [k: string]: string }  // 系统上下文（git 状态等）
  canUseTool: CanUseToolFn      // 工具权限检查函数
  toolUseContext: ToolUseContext // 工具执行上下文
  fallbackModel?: string        // 备用模型
  querySource: QuerySource      // 查询来源标识
  maxTurns?: number             // 最大轮次限制
  taskBudget?: { total: number }  // 令牌预算
}
```

### 1.4 State — 循环迭代间的可变状态（第 204 行）

```ts
type State = {
  messages: Message[]               // 累积的消息列表
  toolUseContext: ToolUseContext     // 工具执行上下文
  autoCompactTracking: ...          // 自动压缩跟踪
  maxOutputTokensRecoveryCount: number  // 输出令牌恢复尝试次数
  hasAttemptedReactiveCompact: boolean  // 是否已尝试响应式压缩
  maxOutputTokensOverride: number | undefined  // 输出令牌覆盖
  pendingToolUseSummary: Promise<...>   // 待处理的工具使用摘要
  stopHookActive: boolean | undefined   // stop hook 是否活跃
  turnCount: number                     // 当前轮次
  transition: Continue | undefined      // 上一次迭代为何 continue
}
```

**设计关键**：每次 `continue` 时通过 `state = { ... }` 一次性更新所有状态，而不是分散的 9 个赋值。`transition` 字段记录了为什么要继续循环（便于调试和测试）。

### 1.5 queryLoop() 核心流程（第 241 行）

`while (true)` 循环（第 307 行）的每次迭代代表一次 API 调用。循环直到：
- 模型不需要工具调用 → `return { reason: 'completed' }`
- 被用户中断 → `return { reason: 'aborted_*' }`
- 达到最大轮次 → `return { reason: 'max_turns' }`
- 遇到不可恢复的错误 → `return { reason: 'model_error' }`

#### 步骤 1：消息预处理

```
每次迭代开头:
  ├── 解构 state → messages, toolUseContext, tracking, ...
  ├── getMessagesAfterCompactBoundary() — 只保留压缩边界后的消息
  ├── snip 处理（feature flag，跳过）
  ├── microcompact 处理（feature flag，跳过）
  └── autocompact 检查 — 消息过长时自动压缩
```

#### 步骤 2：系统提示构建（第 449 行）

```ts
const fullSystemPrompt = asSystemPrompt(
  appendSystemContext(systemPrompt, systemContext),
)
```

将系统上下文（git 状态、日期等）追加到系统提示。注意：用户上下文（CLAUDE.md 等）不在这里注入，而是在 `deps.callModel()` 调用时通过 `prependUserContext(messagesForQuery, userContext)` 注入到消息数组的最前面（第 660 行）。

#### 步骤 3：Autocompact（第 454-543 行）

当消息历史过长时自动压缩：

```
autocompact 流程:
  ├── 检查 token 数量是否超过阈值
  ├── 超过 → 调用 compact API（用 Haiku 总结历史）
  │   ├── yield compactBoundaryMessage  ← 标记压缩边界
  │   └── 更新 messages 为压缩后的版本
  └── 未超过 → 继续
```

#### 步骤 4：调用 API（第 559-708 行）— 核心

StreamingToolExecutor 在第 562 行初始化，API 调用在第 659 行开始：

```ts
// 第 562 行：初始化流式工具执行器
let streamingToolExecutor = useStreamingToolExecution
  ? new StreamingToolExecutor(
      toolUseContext.options.tools, canUseTool, toolUseContext,
    )
  : null

// 第 659 行：调用 API
for await (const message of deps.callModel({
  messages: prependUserContext(messagesForQuery, userContext),  // ← 用户上下文注入到消息最前面
  systemPrompt: fullSystemPrompt,
  thinkingConfig: toolUseContext.options.thinkingConfig,
  tools: toolUseContext.options.tools,
  signal: toolUseContext.abortController.signal,
  options: { model: currentModel, querySource, fallbackModel, ... }
})) {
  // 处理每条流式消息（第 708-866 行）
}
```

`deps.callModel()` 最终调用 `claude.ts` 的 `queryModelWithStreaming()`。

#### 步骤 5：流式响应处理（第 708-866 行）

处理逻辑在 `for await` 循环体内（第 708 行的 `})` 之后到第 866 行）：

```
for await (const message of stream):
  ├── message.type === 'assistant'?
  │   ├── 记录到 assistantMessages[]
  │   ├── 提取 tool_use 块 → toolUseBlocks[]
  │   ├── needsFollowUp = true（如果有 tool_use）
  │   └── streamingToolExecutor.addTool()  ← 流式工具并行执行
  │
  ├── withheld? (prompt-too-long / max_output_tokens)
  │   └── 暂扣不 yield，等后面恢复逻辑处理
  │
  └── yield message  ← 正常 yield 给上层（REPL/QueryEngine）
```

**StreamingToolExecutor**：在 API 流式返回的同时就开始执行工具（如读文件），不等流结束。通过 `addTool()` 添加待执行工具，`getCompletedResults()` 获取已完成的结果。

#### 步骤 6A：无 followUp — 终止/恢复（第 1065-1360 行）

当模型没有请求工具调用时（`needsFollowUp === false`）：

```
无 followUp:
  ├── prompt-too-long 恢复?
  │   ├── context collapse drain（feature flag，跳过）
  │   ├── reactive compact → 压缩消息重试
  │   └── 都失败 → yield 错误 + return
  │
  ├── max_output_tokens 恢复?
  │   ├── 第一次 → 升级到 64k token 限制，continue
  │   ├── 后续 → 注入恢复消息（"继续，别道歉"），continue
  │   └── 超过 3 次 → yield 错误 + return
  │
  ├── stop hooks 执行
  │   ├── preventContinuation? → return
  │   └── blockingErrors? → 将错误加入消息，continue
  │
  └── return { reason: 'completed' }  ★ 正常结束
```

**恢复消息内容（第 1229 行）**：
```
"Output token limit hit. Resume directly — no apology, no recap of what
you were doing. Pick up mid-thought if that is where the cut happened.
Break remaining work into smaller pieces."
```

#### 步骤 6B：有 followUp — 工具执行 + 下一轮（第 1363-1731 行）

当模型请求了工具调用时（`needsFollowUp === true`）：

```
有 followUp:
  ├── 工具执行（两种模式）
  │   ├── streamingToolExecutor? → getRemainingResults()（流式已启动）
  │   └── 否 → runTools()（传统顺序执行）
  │
  ├── for await (const update of toolUpdates):
  │   ├── yield update.message  ← 工具结果消息
  │   └── toolResults.push(...)  ← 收集工具结果
  │
  ├── 中断检查（abortController.signal.aborted）
  │   └── return { reason: 'aborted_tools' }
  │
  ├── attachment 注入
  │   ├── 排队命令（其他线程提交的消息）
  │   ├── 内存预取（相关记忆文件）
  │   └── 技能发现预取
  │
  ├── maxTurns 检查
  │   └── 超过 → yield max_turns_reached + return
  │
  └── state = { messages: [...old, ...assistant, ...toolResults], turnCount: +1 }
      → continue  ★ 回到循环顶部，发起下一次 API 调用
```

### 1.6 错误处理与模型降级（第 897-956 行）

```
API 调用出错:
  ├── FallbackTriggeredError（529 过载）?
  │   ├── 切换到 fallbackModel
  │   ├── 清空本轮 assistant/tool 消息
  │   ├── yield 系统消息 "Switched to X due to high demand for Y"
  │   └── continue（重试整个请求）
  │
  └── 其他错误
      ├── ImageSizeError/ImageResizeError → yield 友好错误 + return
      ├── yieldMissingToolResultBlocks() — 补全未配对的 tool_result
      └── yield API 错误消息 + return
```

### 1.7 关键设计思想

| 设计 | 说明 |
|------|------|
| **AsyncGenerator 模式** | `query()` 是 `async function*`，通过 `yield` 逐条产出事件，调用者用 `for await` 消费 |
| **while(true) + state 对象** | 每次 `continue` 构建新 State 对象，避免分散的状态修改 |
| **transition 字段** | 记录为什么要 continue（`next_turn`、`max_output_tokens_recovery`、`reactive_compact_retry`...），便于调试 |
| **StreamingToolExecutor** | API 流式返回时就并行执行工具，不等流结束 |
| **Withheld 消息** | 可恢复错误先暂扣，恢复成功则不 yield 错误，失败才 yield |

---

## 2. QueryEngine.ts（1320 行）— 高层编排器

**文件路径**: `src/QueryEngine.ts`

### 2.1 定位

QueryEngine 是 `query()` 的**上层包装**，主要用于：
- **print 模式**（`claude -p`）：通过 `ask()` → `QueryEngine.submitMessage()`
- **SDK 模式**：外部程序通过 SDK 调用
- **REPL 不用它**：REPL 直接调用 `query()`

### 2.2 文件结构

```
QueryEngine.ts (1320 行)
├── [0-130]      Import 区 + feature flag 条件模块
├── [131-174]    QueryEngineConfig 类型定义
├── [185-1202]   QueryEngine 类
│   ├── [185-208]    成员变量 + constructor
│   ├── [210-1181]   submitMessage() — 核心方法（~970 行）
│   │   ├── [210-400]    参数解析 + processUserInputContext 构建
│   │   ├── [400-465]    用户输入处理 + 会话持久化
│   │   ├── [465-660]    斜杠命令处理 + 无需查询的快速返回
│   │   ├── [660-690]    文件历史快照
│   │   ├── [679-1074]   ★ for await (const message of query({...})) — 消费 query()
│   │   └── [1074-1181]  结果提取 + yield result
│   ├── [1183-1202]  interrupt() / getMessages() / setModel() 辅助方法
├── [1210-1320]  ask() — 便捷包装函数
```

### 2.3 QueryEngineConfig

```ts
type QueryEngineConfig = {
  cwd: string                    // 工作目录
  tools: Tools                   // 工具列表
  commands: Command[]            // 斜杠命令
  mcpClients: MCPServerConnection[]  // MCP 服务器连接
  agents: AgentDefinition[]      // Agent 定义
  canUseTool: CanUseToolFn       // 权限检查
  getAppState / setAppState      // 全局状态存取
  initialMessages?: Message[]    // 初始消息（恢复对话）
  readFileCache: FileStateCache  // 文件读取缓存
  customSystemPrompt?: string    // 自定义系统提示
  thinkingConfig?: ThinkingConfig // 思考模式配置
  maxTurns?: number              // 最大轮次
  maxBudgetUsd?: number          // USD 预算上限
  jsonSchema?: Record<...>       // 结构化输出 schema
  // ... 更多配置
}
```

### 2.4 submitMessage() 核心流程

```
submitMessage(prompt)
  │
  ├── 1. 参数准备
  │   ├── 解构 config 获取 tools, commands, model, ...
  │   ├── 构建 wrappedCanUseTool（包装权限检查，跟踪拒绝）
  │   ├── fetchSystemPromptParts() — 获取系统提示各部分
  │   └── 构建 processUserInputContext
  │
  ├── 2. 用户输入处理
  │   ├── processUserInput(prompt) — 解析斜杠命令 / 普通文本
  │   ├── mutableMessages.push(...messagesFromUserInput)
  │   └── recordTranscript(messages) — 持久化到 JSONL
  │
  ├── 3. yield buildSystemInitMessage() — SDK 初始化消息
  │
  ├── 4. shouldQuery === false?（斜杠命令的本地执行结果）
  │   ├── yield 命令输出
  │   ├── yield { type: 'result', subtype: 'success' }
  │   └── return
  │
  ├── 5. ★ for await (const message of query({...}))
  │   │   消费 query() 产出的每条消息
  │   │
  │   ├── message.type === 'assistant'
  │   │   ├── mutableMessages.push(msg)
  │   │   ├── recordTranscript()  ← fire-and-forget
  │   │   ├── yield* normalizeMessage(msg) — 转换为 SDK 格式
  │   │   └── 捕获 stop_reason
  │   │
  │   ├── message.type === 'user'（工具结果）
  │   │   ├── mutableMessages.push(msg)
  │   │   ├── turnCount++
  │   │   └── yield* normalizeMessage(msg)
  │   │
  │   ├── message.type === 'stream_event'
  │   │   ├── 跟踪 usage（message_start/delta/stop）
  │   │   └── includePartialMessages? → yield 流事件
  │   │
  │   ├── message.type === 'system'
  │   │   ├── compact_boundary → GC 旧消息 + yield 给 SDK
  │   │   └── api_error → yield 重试信息
  │   │
  │   └── maxBudgetUsd 检查 → 超预算则 yield error + return
  │
  └── 6. yield { type: 'result', subtype: 'success', result: textResult }
```

### 2.5 ask() 便捷函数（第 1211 行）

```ts
export async function* ask({ prompt, tools, ... }) {
  const engine = new QueryEngine({ ... })
  try {
    yield* engine.submitMessage(prompt)
  } finally {
    setReadFileCache(engine.getReadFileState())
  }
}
```

`ask()` 是 `QueryEngine` 的一次性包装，创建 engine → 提交消息 → 清理。用于 `print.ts` 的 `--print` 模式。

### 2.6 QueryEngine vs REPL 直接调用 query()

| 特性 | QueryEngine (SDK/print) | REPL 直接调用 query() |
|------|------------------------|---------------------|
| 会话持久化 | 自动 recordTranscript | 由 useLogMessages 处理 |
| Usage 跟踪 | 内部 totalUsage 累积 | 由外层 cost-tracker 处理 |
| 权限拒绝跟踪 | 记录 permissionDenials[] | 直接 UI 交互 |
| 结果格式 | yield SDKMessage 格式 | 原始 Message 格式 |
| 消息 GC | compact_boundary 后释放旧消息 | UI 需要保留完整历史 |

---

## 3. claude.ts（3420 行）— API 客户端

**文件路径**: `src/services/api/claude.ts`

### 3.1 文件结构

```
claude.ts (3420 行)
├── [0-260]      Import 区（大量 SDK 类型、工具函数）
├── [272-331]    getExtraBodyParams() — 构建额外请求体参数
├── [333-502]    缓存相关（getPromptCachingEnabled, getCacheControl, should1hCacheTTL, configureEffortParams, configureTaskBudgetParams）
├── [504-587]    verifyApiKey() — API 密钥验证
├── [589-675]    消息转换（userMessageToMessageParam, assistantMessageToMessageParam）
├── [677-708]    Options 类型定义
├── [710-781]    queryModelWithoutStreaming / queryModelWithStreaming — 公开的两个入口
├── [783-813]    辅助函数（shouldDeferLspTool, getNonstreamingFallbackTimeoutMs）
├── [819-918]    executeNonStreamingRequest() — 非流式请求辅助
├── [920-999]    更多辅助函数（getPreviousRequestIdFromMessages, stripExcessMediaItems）
├── [1018-3420]  ★ queryModel() — 核心私有函数（2400 行）
│   ├── [1018-1370]   前置检查 + 工具 schema 构建 + 消息归一化 + 系统提示组装
│   ├── [1539-1730]   paramsFromContext() — 构建 API 请求参数
│   ├── [1777-2100]   withRetry + 流式 API 调用（anthropic.beta.messages.create + stream）
│   ├── [1941-2300]   流式事件处理（for await of stream）
│   └── [2300-3420]   非流式降级 + 日志、分析、清理
```

### 3.2 两个公开入口

```ts
// 入口 1：流式（主要路径）
export async function* queryModelWithStreaming({
  messages, systemPrompt, thinkingConfig, tools, signal, options
}) {
  yield* withStreamingVCR(messages, async function* () {
    yield* queryModel(messages, systemPrompt, thinkingConfig, tools, signal, options)
  })
}

// 入口 2：非流式（compact 等内部用途）
export async function queryModelWithoutStreaming({
  messages, systemPrompt, thinkingConfig, tools, signal, options
}) {
  let assistantMessage
  for await (const message of ...) {
    if (message.type === 'assistant') assistantMessage = message
  }
  return assistantMessage
}
```

两者都委托给内部的 `queryModel()`。`withStreamingVCR` 是一个 VCR（录像/回放）包装器，用于调试。

### 3.3 Options 类型（第 677 行）

```ts
type Options = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string                      // 模型名称
  toolChoice?: BetaToolChoiceTool    // 强制使用特定工具
  isNonInteractiveSession: boolean   // 是否非交互模式
  fallbackModel?: string             // 备用模型
  querySource: QuerySource           // 查询来源
  agents: AgentDefinition[]          // Agent 定义
  enablePromptCaching?: boolean      // 启用提示缓存
  effortValue?: EffortValue          // 推理努力级别
  mcpTools: Tools                    // MCP 工具
  fastMode?: boolean                 // 快速模式
  taskBudget?: { total: number; remaining?: number }  // 令牌预算
}
```

### 3.4 queryModel() 核心流程（第 1018 行）

这是整个 API 调用的核心，2400 行。关键步骤：

#### 阶段 1：前置准备（1018-1400 行）

```
queryModel()
  ├── off-switch 检查（Opus 过载时的全局关闭开关）
  ├── beta headers 组装（getMergedBetas）
  │   ├── 基础 betas
  │   ├── advisor beta（如果启用）
  │   ├── tool search beta（如果启用）
  │   ├── cache scope beta
  │   └── effort / task budget betas
  │
  ├── 工具过滤
  │   ├── tool search 启用 → 只包含已发现的 deferred tools
  │   └── tool search 未启用 → 过滤掉 ToolSearchTool
  │
  ├── toolToAPISchema() — 每个工具转为 API 格式
  │
  ├── normalizeMessagesForAPI() — 消息转换为 API 格式
  │   ├── UserMessage → { role: 'user', content: ... }
  │   ├── AssistantMessage → { role: 'assistant', content: ... }
  │   └── 跳过 system/attachment/progress 等内部消息类型
  │
  └── 系统提示最终组装
      ├── getAttributionHeader(fingerprint)
      ├── getCLISyspromptPrefix()
      ├── ...systemPrompt
      └── advisor 指令（如果启用）
```

#### 阶段 2：构建请求参数 — paramsFromContext()（第 1539-1730 行）

```ts
const paramsFromContext = (retryContext: RetryContext) => {
  // ... 动态 beta headers、effort、task budget 配置 ...
  
  // 思考模式配置（adaptive 或 enabled + budget）
  let thinking = undefined
  if (hasThinking && modelSupportsThinking(options.model)) {
    if (modelSupportsAdaptiveThinking(options.model)) {
      thinking = { type: 'adaptive' }
    } else {
      thinking = { type: 'enabled', budget_tokens: thinkingBudget }
    }
  }

  return {
    model: normalizeModelStringForAPI(options.model),
    messages: addCacheBreakpoints(messagesForAPI, ...),  // 带缓存标记的消息
    system,                           // 系统提示块（已构建好）
    tools: allTools,                  // 工具 schema
    tool_choice: options.toolChoice,
    max_tokens: maxOutputTokens,
    thinking,
    ...(temperature !== undefined && { temperature }),
    ...(useBetas && { betas: betasParams }),
    metadata: getAPIMetadata(),
    ...extraBodyParams,
    ...(speed !== undefined && { speed }),  // 快速模式
  }
}
```

#### 阶段 3：流式 API 调用（第 1779-1858 行）

```ts
// 使用 withRetry 包装，自动处理重试
const generator = withRetry(
  () => getAnthropicClient({ maxRetries: 0, model, source: querySource }),
  async (anthropic, attempt, context) => {
    const params = paramsFromContext(context)

    // ★ 核心 API 调用（第 1823 行）
    // 使用 .create() + stream: true（而非 .stream()）
    // 避免 BetaMessageStream 的 O(n²) partial JSON 解析开销
    const result = await anthropic.beta.messages
      .create(
        { ...params, stream: true },
        { signal, ...(clientRequestId && { headers: { ... } }) },
      )
      .withResponse()

    return result.data  // Stream<BetaRawMessageStreamEvent>
  },
  { model, fallbackModel, thinkingConfig, signal, querySource }
)

// 消费 withRetry 的系统错误消息（重试通知等）
let e
do {
  e = await generator.next()
  if (!('controller' in e.value)) yield e.value  // yield API 错误消息
} while (!e.done)
stream = e.value  // 获取最终的 Stream 对象

// 处理流式事件（第 1941 行）
for await (const part of stream) {
  switch (part.type) {
    case 'message_start':    // 记录 request_id、usage
    case 'content_block_start':  // 新的内容块开始（text/thinking/tool_use）
    case 'content_block_delta':  // 增量内容 → yield stream_event 给 UI
    case 'content_block_stop':   // 内容块完成 → yield AssistantMessage
    case 'message_delta':    // stop_reason、usage 更新
    case 'message_stop':     // 整条消息完成
  }
}
```

#### 阶段 4：withRetry 重试策略

```
withRetry 逻辑:
  ├── 429 (Rate Limit) → 等待 Retry-After 后重试
  ├── 529 (Overloaded) → 切换到 fallbackModel，throw FallbackTriggeredError
  ├── 500 (Server Error) → 指数退避重试
  ├── 408 (Timeout) → 重试
  ├── 其他错误 → 不重试，直接抛出
  └── 最大重试次数: 根据模型和错误类型动态计算
```

#### 阶段 5：非流式降级

当流式请求中途失败时，可能降级为非流式请求：

```
流式失败（部分响应已收到）:
  ├── 已接收的内容 → yield 给上层
  ├── 剩余部分 → 降级为非流式请求（anthropic.beta.messages.create）
  └── 非流式结果 → 转换格式 yield
```

### 3.5 消息转换函数

```ts
// UserMessage → API 格式
userMessageToMessageParam(message, addCache, enablePromptCaching, querySource)
  → { role: 'user', content: [...] }
  // addCache=true 时最后一个 content block 添加 cache_control

// AssistantMessage → API 格式
assistantMessageToMessageParam(message, addCache, enablePromptCaching, querySource)
  → { role: 'assistant', content: [...] }
  // thinking/redacted_thinking 块不加 cache_control
```

### 3.6 Prompt Caching 策略

```
缓存策略:
  ├── cache_control: { type: 'ephemeral' }  — 默认，5 分钟 TTL
  ├── cache_control: { type: 'ephemeral', ttl: '1h' }  — 订阅用户/Ant，1 小时
  ├── cache_control: { ..., scope: 'global' }  — 跨会话共享（无 MCP 工具时）
  └── 禁用条件：
      ├── DISABLE_PROMPT_CACHING 环境变量
      ├── DISABLE_PROMPT_CACHING_HAIKU（仅 Haiku）
      └── DISABLE_PROMPT_CACHING_SONNET（仅 Sonnet）
```

### 3.7 多 Provider 支持

`getAnthropicClient()` 根据配置返回不同的 SDK 客户端：

| Provider | 入口 | 说明 |
|----------|------|------|
| Anthropic | 直接 API | 默认，`api.anthropic.com` |
| AWS Bedrock | 通过 Bedrock | 使用 `@anthropic-ai/bedrock-sdk` |
| Google Vertex | 通过 Vertex | 使用 `@anthropic-ai/vertex-sdk` |
| Azure | 通过 Azure | 类似 Bedrock 的包装 |

Provider 选择逻辑在 `src/utils/model/providers.ts` 的 `getAPIProvider()` 中。

---

## 完整数据流：一次工具调用的生命周期

以用户输入 "读取 README.md" 为例：

```
1. REPL.tsx: 用户按回车
   onSubmit("读取 README.md")
     └── handlePromptSubmit()
           └── onQuery([userMessage])

2. REPL.tsx: onQueryImpl()
   ├── getSystemPrompt() + getUserContext() + getSystemContext()
   └── for await (event of query({messages, systemPrompt, ...}))

3. query.ts: queryLoop() — 第 1 次迭代
   ├── messagesForQuery = [...messages]  // 包含用户消息
   ├── deps.callModel({...})
   │     └── claude.ts: queryModel()
   │           ├── 构建 API 参数
   │           └── anthropic.beta.messages.create({ ...params, stream: true })
   │
   ├── API 流式返回:
   │   content_block_start: { type: 'tool_use', name: 'Read', id: 'toolu_123' }
   │   content_block_delta: { input: '{"file_path": "/path/to/README.md"}' }
   │   content_block_stop
   │   message_delta: { stop_reason: 'tool_use' }
   │
   ├── 收集: toolUseBlocks = [{ name: 'Read', id: 'toolu_123', input: {...} }]
   ├── needsFollowUp = true
   │
   ├── 工具执行:
   │   streamingToolExecutor.getRemainingResults()
   │     └── Read 工具执行 → 返回文件内容
   │   yield toolResultMessage  ← 包含文件内容
   │
   └── state = { messages: [...old, assistantMsg, toolResultMsg], turnCount: 2 }
       → continue

4. query.ts: queryLoop() — 第 2 次迭代
   ├── messagesForQuery 现在包含:
   │   [userMsg, assistantMsg(tool_use), userMsg(tool_result)]
   │
   ├── deps.callModel({...})  ← 再次调用 API
   │
   ├── API 返回:
   │   content_block_start: { type: 'text' }
   │   content_block_delta: { text: "README.md 的内容是..." }
   │   content_block_stop
   │   message_delta: { stop_reason: 'end_turn' }
   │
   ├── toolUseBlocks = []  ← 没有工具调用
   ├── needsFollowUp = false
   │
   └── return { reason: 'completed' }  ★ 循环结束

5. REPL.tsx: onQueryEvent(event)
   ├── 更新 streamingText（打字机效果）
   ├── 更新 messages 数组
   └── 重新渲染 UI
```

---

## 关键设计模式总结

| 模式 | 位置 | 说明 |
|------|------|------|
| AsyncGenerator 链式传递 | query.ts → claude.ts | `yield*` 将底层事件透传给上层，形成事件流管道 |
| while(true) + State 对象 | query.ts queryLoop | 循环迭代间通过不可变 State 传递，transition 字段记录原因 |
| StreamingToolExecutor | query.ts | API 流式返回时并行执行工具，不等流结束 |
| Withheld 消息 | query.ts | 可恢复错误先暂扣不 yield，恢复成功则吞掉错误 |
| withRetry 重试 | claude.ts | 429/500/529 自动重试，529 触发模型降级 |
| Prompt Caching | claude.ts | 缓存系统提示和历史消息，减少 API token 消耗 |
| 非流式降级 | claude.ts | 流式请求中途失败时降级为非流式完成剩余部分 |
| QueryEngine 包装 | QueryEngine.ts | 为 SDK/print 提供会话管理、持久化、usage 跟踪 |

## 需要忽略的代码

| 模式 | 说明 |
|------|------|
| `feature('REACTIVE_COMPACT')` / `feature('CONTEXT_COLLAPSE')` 等 | 所有 feature flag 保护的代码 — 全部是死代码 |
| `feature('CACHED_MICROCOMPACT')` | 缓存微压缩 — 死代码 |
| `feature('HISTORY_SNIP')` / `snipModule` | 历史截断 — 死代码 |
| `feature('TOKEN_BUDGET')` / `budgetTracker` | 令牌预算 — 死代码 |
| `feature('BG_SESSIONS')` / `taskSummaryModule` | 后台会话 — 死代码 |
| `process.env.USER_TYPE === 'ant'` | Anthropic 内部专用代码 |
| VCR (withStreamingVCR/withVCR) | 调试录像/回放包装器，不影响正常流程 |