# 第二階段：核心對話循環詳解

> 用戶發一句話後，如何變成 API 請求、如何處理流式響應和工具呼叫

## 對話循環總覽

```
用戶輸入 "幫我讀取 README.md"
  │
  ▼
REPL.tsx: onSubmit → onQuery → onQueryImpl
  │
  ├── 1. 並行加載上下文:
  │     getSystemPrompt() + getUserContext() + getSystemContext()
  │
  ├── 2. buildEffectiveSystemPrompt() — 合成最終系統提示
  │
  ├── 3. for await (const event of query({...}))  ★ 核心循環
  │     │
  │     │  query.ts: queryLoop()
  │     │    ├── while (true) {
  │     │    │     ├── autocompact / microcompact 處理
  │     │    │     ├── deps.callModel() → claude.ts 流式 API 呼叫
  │     │    │     │     └── for await (message of stream) { yield message }
  │     │    │     │
  │     │    │     ├── 收集 assistant 訊息中的 tool_use 塊
  │     │    │     │
  │     │    │     ├── needsFollowUp?
  │     │    │     │     ├── true → 執行工具 → 收集結果 → state = next → continue
  │     │    │     │     └── false → 檢查錯誤恢復 → return { reason: 'completed' }
  │     │    │     }
  │     │
  │     └── onQueryEvent(event) — 更新 UI 狀態
  │
  └── 4. 收尾: resetLoadingState(), onTurnComplete()
```

### 兩條資料路徑

| 路徑 | 呼叫方 | 說明 |
|------|--------|------|
| **交互式（REPL）** | REPL.tsx → `query()` | 直接呼叫 `query()` AsyncGenerator |
| **非交互式（SDK/print）** | print.ts → `QueryEngine.submitMessage()` → `query()` | 通過 QueryEngine 包裝，增加了會話持久化、usage 跟蹤等 |

---

## 1. query.ts（1732 行）— 核心查詢循環

**檔案路徑**: `src/query.ts`

### 1.1 文件結構

```
query.ts (1732 行)
├── [0-120]      Import 區 + feature flag 條件模組加載
├── [122-148]    yieldMissingToolResultBlocks() — 爲未配對的 tool_use 生成錯誤 tool_result
├── [150-178]    常量與輔助函數 (MAX_OUTPUT_TOKENS_RECOVERY_LIMIT, isWithheldMaxOutputTokens)
├── [180-198]    QueryParams 類型定義
├── [200-216]    State 類型 — 循環迭代間的可變狀態
├── [218-238]    query() — 導出的 AsyncGenerator，委託給 queryLoop()
├── [240-1732]   queryLoop() — 核心 while(true) 循環
│   ├── [241-306]    初始化 State + 內存預取
│   ├── [307-448]    循環開頭：解構 state、訊息預處理（snip/microcompact/context collapse）
│   ├── [449-578]    系統提示構建(第449行) + autocompact(第453行) + StreamingToolExecutor 初始化(第562行)
│   ├── [650-866]    ★ deps.callModel()(第659行) + 流式響應處理 + tool_use 收集
│   ├── [896-956]    錯誤處理（FallbackTriggeredError、通用錯誤）
│   ├── [1002-1054]  中斷處理（abortController.signal.aborted）
│   ├── [1065-1360]  無 followUp 時的終止/恢復邏輯
│   │   ├── prompt-too-long 恢復
│   │   ├── max_output_tokens 恢復（升級 + 多輪）
│   │   ├── stop hooks 執行
│   │   └── return { reason: 'completed' }
│   └── [1360-1732]  有 followUp 時的工具執行 + 下一輪準備
│       ├── 工具執行（streaming 或 sequential）
│       ├── attachment 注入（排隊命令、內存預取、技能發現）
│       ├── maxTurns 檢查
│       └── state = next → continue
```

### 1.2 入口：query() 函數（第 219 行）

```ts
export async function* query(params: QueryParams):
  AsyncGenerator<StreamEvent | Message | ..., Terminal> {
  const consumedCommandUuids: string[] = []
  const terminal = yield* queryLoop(params, consumedCommandUuids)
  // 通知所有消費的排隊命令已完成
  for (const uuid of consumedCommandUuids) {
    notifyCommandLifecycle(uuid, 'completed')
  }
  return terminal
}
```

`query()` 本身很薄，只做兩件事：
1. 委託給 `queryLoop()` 執行實際邏輯
2. 在正常返回後通知排隊命令的生命週期

### 1.3 QueryParams（第 181 行）

```ts
type QueryParams = {
  messages: Message[]           // 當前對話訊息
  systemPrompt: SystemPrompt    // 系統提示
  userContext: { [k: string]: string }  // 用戶上下文（CLAUDE.md 等）
  systemContext: { [k: string]: string }  // 系統上下文（git 狀態等）
  canUseTool: CanUseToolFn      // 工具權限檢查函數
  toolUseContext: ToolUseContext // 工具執行上下文
  fallbackModel?: string        // 備用模型
  querySource: QuerySource      // 查詢來源標識
  maxTurns?: number             // 最大輪次限制
  taskBudget?: { total: number }  // 令牌預算
}
```

### 1.4 State — 循環迭代間的可變狀態（第 204 行）

```ts
type State = {
  messages: Message[]               // 累積的訊息列表
  toolUseContext: ToolUseContext     // 工具執行上下文
  autoCompactTracking: ...          // 自動壓縮跟蹤
  maxOutputTokensRecoveryCount: number  // 輸出令牌恢復嘗試次數
  hasAttemptedReactiveCompact: boolean  // 是否已嘗試響應式壓縮
  maxOutputTokensOverride: number | undefined  // 輸出令牌覆蓋
  pendingToolUseSummary: Promise<...>   // 待處理的工具使用摘要
  stopHookActive: boolean | undefined   // stop hook 是否活躍
  turnCount: number                     // 當前輪次
  transition: Continue | undefined      // 上一次迭代爲何 continue
}
```

**設計關鍵**：每次 `continue` 時通過 `state = { ... }` 一次性更新所有狀態，而不是分散的 9 個賦值。`transition` 字段記錄了爲什麼要繼續循環（便於調試和測試）。

### 1.5 queryLoop() 核心流程（第 241 行）

`while (true)` 循環（第 307 行）的每次迭代代表一次 API 呼叫。循環直到：
- 模型不需要工具呼叫 → `return { reason: 'completed' }`
- 被用戶中斷 → `return { reason: 'aborted_*' }`
- 達到最大輪次 → `return { reason: 'max_turns' }`
- 遇到不可恢復的錯誤 → `return { reason: 'model_error' }`

#### 步驟 1：訊息預處理

```
每次迭代開頭:
  ├── 解構 state → messages, toolUseContext, tracking, ...
  ├── getMessagesAfterCompactBoundary() — 只保留壓縮邊界後的訊息
  ├── snip 處理（feature flag，跳過）
  ├── microcompact 處理（feature flag，跳過）
  └── autocompact 檢查 — 訊息過長時自動壓縮
```

#### 步驟 2：系統提示構建（第 449 行）

```ts
const fullSystemPrompt = asSystemPrompt(
  appendSystemContext(systemPrompt, systemContext),
)
```

將系統上下文（git 狀態、日期等）追加到系統提示。注意：用戶上下文（CLAUDE.md 等）不在這裏注入，而是在 `deps.callModel()` 呼叫時通過 `prependUserContext(messagesForQuery, userContext)` 注入到訊息數組的最前面（第 660 行）。

#### 步驟 3：Autocompact（第 454-543 行）

當訊息歷史過長時自動壓縮：

```
autocompact 流程:
  ├── 檢查 token 數量是否超過閾值
  ├── 超過 → 呼叫 compact API（用 Haiku 總結歷史）
  │   ├── yield compactBoundaryMessage  ← 標記壓縮邊界
  │   └── 更新 messages 爲壓縮後的版本
  └── 未超過 → 繼續
```

#### 步驟 4：呼叫 API（第 559-708 行）— 核心

StreamingToolExecutor 在第 562 行初始化，API 呼叫在第 659 行開始：

```ts
// 第 562 行：初始化流式工具執行器
let streamingToolExecutor = useStreamingToolExecution
  ? new StreamingToolExecutor(
      toolUseContext.options.tools, canUseTool, toolUseContext,
    )
  : null

// 第 659 行：呼叫 API
for await (const message of deps.callModel({
  messages: prependUserContext(messagesForQuery, userContext),  // ← 用戶上下文注入到訊息最前面
  systemPrompt: fullSystemPrompt,
  thinkingConfig: toolUseContext.options.thinkingConfig,
  tools: toolUseContext.options.tools,
  signal: toolUseContext.abortController.signal,
  options: { model: currentModel, querySource, fallbackModel, ... }
})) {
  // 處理每條流式訊息（第 708-866 行）
}
```

`deps.callModel()` 最終呼叫 `claude.ts` 的 `queryModelWithStreaming()`。

#### 步驟 5：流式響應處理（第 708-866 行）

處理邏輯在 `for await` 循環體內（第 708 行的 `})` 之後到第 866 行）：

```
for await (const message of stream):
  ├── message.type === 'assistant'?
  │   ├── 記錄到 assistantMessages[]
  │   ├── 提取 tool_use 塊 → toolUseBlocks[]
  │   ├── needsFollowUp = true（如果有 tool_use）
  │   └── streamingToolExecutor.addTool()  ← 流式工具並行執行
  │
  ├── withheld? (prompt-too-long / max_output_tokens)
  │   └── 暫扣不 yield，等後面恢復邏輯處理
  │
  └── yield message  ← 正常 yield 給上層（REPL/QueryEngine）
```

**StreamingToolExecutor**：在 API 流式返回的同時就開始執行工具（如讀文件），不等流結束。通過 `addTool()` 添加待執行工具，`getCompletedResults()` 取得已完成的結果。

#### 步驟 6A：無 followUp — 終止/恢復（第 1065-1360 行）

當模型沒有請求工具呼叫時（`needsFollowUp === false`）：

```
無 followUp:
  ├── prompt-too-long 恢復?
  │   ├── context collapse drain（feature flag，跳過）
  │   ├── reactive compact → 壓縮訊息重試
  │   └── 都失敗 → yield 錯誤 + return
  │
  ├── max_output_tokens 恢復?
  │   ├── 第一次 → 升級到 64k token 限制，continue
  │   ├── 後續 → 注入恢復訊息（"繼續，別道歉"），continue
  │   └── 超過 3 次 → yield 錯誤 + return
  │
  ├── stop hooks 執行
  │   ├── preventContinuation? → return
  │   └── blockingErrors? → 將錯誤加入訊息，continue
  │
  └── return { reason: 'completed' }  ★ 正常結束
```

**恢復訊息內容（第 1229 行）**：
```
"Output token limit hit. Resume directly — no apology, no recap of what
you were doing. Pick up mid-thought if that is where the cut happened.
Break remaining work into smaller pieces."
```

#### 步驟 6B：有 followUp — 工具執行 + 下一輪（第 1363-1731 行）

當模型請求了工具呼叫時（`needsFollowUp === true`）：

```
有 followUp:
  ├── 工具執行（兩種模式）
  │   ├── streamingToolExecutor? → getRemainingResults()（流式已啓動）
  │   └── 否 → runTools()（傳統順序執行）
  │
  ├── for await (const update of toolUpdates):
  │   ├── yield update.message  ← 工具結果訊息
  │   └── toolResults.push(...)  ← 收集工具結果
  │
  ├── 中斷檢查（abortController.signal.aborted）
  │   └── return { reason: 'aborted_tools' }
  │
  ├── attachment 注入
  │   ├── 排隊命令（其他執行緒提交的訊息）
  │   ├── 內存預取（相關記憶文件）
  │   └── 技能發現預取
  │
  ├── maxTurns 檢查
  │   └── 超過 → yield max_turns_reached + return
  │
  └── state = { messages: [...old, ...assistant, ...toolResults], turnCount: +1 }
      → continue  ★ 回到循環頂部，發起下一次 API 呼叫
```

### 1.6 錯誤處理與模型降級（第 897-956 行）

```
API 呼叫出錯:
  ├── FallbackTriggeredError（529 過載）?
  │   ├── 切換到 fallbackModel
  │   ├── 清空本輪 assistant/tool 訊息
  │   ├── yield 系統訊息 "Switched to X due to high demand for Y"
  │   └── continue（重試整個請求）
  │
  └── 其他錯誤
      ├── ImageSizeError/ImageResizeError → yield 友好錯誤 + return
      ├── yieldMissingToolResultBlocks() — 補全未配對的 tool_result
      └── yield API 錯誤訊息 + return
```

### 1.7 關鍵設計思想

| 設計 | 說明 |
|------|------|
| **AsyncGenerator 模式** | `query()` 是 `async function*`，通過 `yield` 逐條產出事件，呼叫者用 `for await` 消費 |
| **while(true) + state 對象** | 每次 `continue` 構建新 State 對象，避免分散的狀態修改 |
| **transition 字段** | 記錄爲什麼要 continue（`next_turn`、`max_output_tokens_recovery`、`reactive_compact_retry`...），便於調試 |
| **StreamingToolExecutor** | API 流式返回時就並行執行工具，不等流結束 |
| **Withheld 訊息** | 可恢復錯誤先暫扣，恢復成功則不 yield 錯誤，失敗才 yield |

---

## 2. QueryEngine.ts（1320 行）— 高層編排器

**檔案路徑**: `src/QueryEngine.ts`

### 2.1 定位

QueryEngine 是 `query()` 的**上層包裝**，主要用於：
- **print 模式**（`claude -p`）：通過 `ask()` → `QueryEngine.submitMessage()`
- **SDK 模式**：外部程式通過 SDK 呼叫
- **REPL 不用它**：REPL 直接呼叫 `query()`

### 2.2 文件結構

```
QueryEngine.ts (1320 行)
├── [0-130]      Import 區 + feature flag 條件模組
├── [131-174]    QueryEngineConfig 類型定義
├── [185-1202]   QueryEngine 類
│   ├── [185-208]    成員變量 + constructor
│   ├── [210-1181]   submitMessage() — 核心方法（~970 行）
│   │   ├── [210-400]    參數解析 + processUserInputContext 構建
│   │   ├── [400-465]    用戶輸入處理 + 會話持久化
│   │   ├── [465-660]    斜槓命令處理 + 無需查詢的快速返回
│   │   ├── [660-690]    檔案歷史快照
│   │   ├── [679-1074]   ★ for await (const message of query({...})) — 消費 query()
│   │   └── [1074-1181]  結果提取 + yield result
│   ├── [1183-1202]  interrupt() / getMessages() / setModel() 輔助方法
├── [1210-1320]  ask() — 便捷包裝函數
```

### 2.3 QueryEngineConfig

```ts
type QueryEngineConfig = {
  cwd: string                    // 工作目錄
  tools: Tools                   // 工具列表
  commands: Command[]            // 斜槓命令
  mcpClients: MCPServerConnection[]  // MCP 服務器連接
  agents: AgentDefinition[]      // Agent 定義
  canUseTool: CanUseToolFn       // 權限檢查
  getAppState / setAppState      // 全局狀態存取
  initialMessages?: Message[]    // 初始訊息（恢復對話）
  readFileCache: FileStateCache  // 檔案讀取快取
  customSystemPrompt?: string    // 自定義系統提示
  thinkingConfig?: ThinkingConfig // 思考模式設定
  maxTurns?: number              // 最大輪次
  maxBudgetUsd?: number          // USD 預算上限
  jsonSchema?: Record<...>       // 結構化輸出 schema
  // ... 更多設定
}
```

### 2.4 submitMessage() 核心流程

```
submitMessage(prompt)
  │
  ├── 1. 參數準備
  │   ├── 解構 config 取得 tools, commands, model, ...
  │   ├── 構建 wrappedCanUseTool（包裝權限檢查，跟蹤拒絕）
  │   ├── fetchSystemPromptParts() — 取得系統提示各部分
  │   └── 構建 processUserInputContext
  │
  ├── 2. 用戶輸入處理
  │   ├── processUserInput(prompt) — 解析斜槓命令 / 普通文本
  │   ├── mutableMessages.push(...messagesFromUserInput)
  │   └── recordTranscript(messages) — 持久化到 JSONL
  │
  ├── 3. yield buildSystemInitMessage() — SDK 初始化訊息
  │
  ├── 4. shouldQuery === false?（斜槓命令的本地執行結果）
  │   ├── yield 命令輸出
  │   ├── yield { type: 'result', subtype: 'success' }
  │   └── return
  │
  ├── 5. ★ for await (const message of query({...}))
  │   │   消費 query() 產出的每條訊息
  │   │
  │   ├── message.type === 'assistant'
  │   │   ├── mutableMessages.push(msg)
  │   │   ├── recordTranscript()  ← fire-and-forget
  │   │   ├── yield* normalizeMessage(msg) — 轉換爲 SDK 格式
  │   │   └── 捕獲 stop_reason
  │   │
  │   ├── message.type === 'user'（工具結果）
  │   │   ├── mutableMessages.push(msg)
  │   │   ├── turnCount++
  │   │   └── yield* normalizeMessage(msg)
  │   │
  │   ├── message.type === 'stream_event'
  │   │   ├── 跟蹤 usage（message_start/delta/stop）
  │   │   └── includePartialMessages? → yield 流事件
  │   │
  │   ├── message.type === 'system'
  │   │   ├── compact_boundary → GC 舊訊息 + yield 給 SDK
  │   │   └── api_error → yield 重試信息
  │   │
  │   └── maxBudgetUsd 檢查 → 超預算則 yield error + return
  │
  └── 6. yield { type: 'result', subtype: 'success', result: textResult }
```

### 2.5 ask() 便捷函數（第 1211 行）

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

`ask()` 是 `QueryEngine` 的一次性包裝，建立 engine → 提交訊息 → 清理。用於 `print.ts` 的 `--print` 模式。

### 2.6 QueryEngine vs REPL 直接呼叫 query()

| 特性 | QueryEngine (SDK/print) | REPL 直接呼叫 query() |
|------|------------------------|---------------------|
| 會話持久化 | 自動 recordTranscript | 由 useLogMessages 處理 |
| Usage 跟蹤 | 內部 totalUsage 累積 | 由外層 cost-tracker 處理 |
| 權限拒絕跟蹤 | 記錄 permissionDenials[] | 直接 UI 交互 |
| 結果格式 | yield SDKMessage 格式 | 原始 Message 格式 |
| 訊息 GC | compact_boundary 後釋放舊訊息 | UI 需要保留完整歷史 |

---

## 3. claude.ts（3420 行）— API 客戶端

**檔案路徑**: `src/services/api/claude.ts`

### 3.1 文件結構

```
claude.ts (3420 行)
├── [0-260]      Import 區（大量 SDK 類型、工具函數）
├── [272-331]    getExtraBodyParams() — 構建額外請求體參數
├── [333-502]    快取相關（getPromptCachingEnabled, getCacheControl, should1hCacheTTL, configureEffortParams, configureTaskBudgetParams）
├── [504-587]    verifyApiKey() — API 密鑰驗證
├── [589-675]    訊息轉換（userMessageToMessageParam, assistantMessageToMessageParam）
├── [677-708]    Options 類型定義
├── [710-781]    queryModelWithoutStreaming / queryModelWithStreaming — 公開的兩個入口
├── [783-813]    輔助函數（shouldDeferLspTool, getNonstreamingFallbackTimeoutMs）
├── [819-918]    executeNonStreamingRequest() — 非流式請求輔助
├── [920-999]    更多輔助函數（getPreviousRequestIdFromMessages, stripExcessMediaItems）
├── [1018-3420]  ★ queryModel() — 核心私有函數（2400 行）
│   ├── [1018-1370]   前置檢查 + 工具 schema 構建 + 訊息歸一化 + 系統提示組裝
│   ├── [1539-1730]   paramsFromContext() — 構建 API 請求參數
│   ├── [1777-2100]   withRetry + 流式 API 呼叫（anthropic.beta.messages.create + stream）
│   ├── [1941-2300]   流式事件處理（for await of stream）
│   └── [2300-3420]   非流式降級 + 日誌、分析、清理
```

### 3.2 兩個公開入口

```ts
// 入口 1：流式（主要路徑）
export async function* queryModelWithStreaming({
  messages, systemPrompt, thinkingConfig, tools, signal, options
}) {
  yield* withStreamingVCR(messages, async function* () {
    yield* queryModel(messages, systemPrompt, thinkingConfig, tools, signal, options)
  })
}

// 入口 2：非流式（compact 等內部用途）
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

兩者都委託給內部的 `queryModel()`。`withStreamingVCR` 是一個 VCR（錄像/回放）包裝器，用於調試。

### 3.3 Options 類型（第 677 行）

```ts
type Options = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string                      // 模型名稱
  toolChoice?: BetaToolChoiceTool    // 強制使用特定工具
  isNonInteractiveSession: boolean   // 是否非交互模式
  fallbackModel?: string             // 備用模型
  querySource: QuerySource           // 查詢來源
  agents: AgentDefinition[]          // Agent 定義
  enablePromptCaching?: boolean      // 啓用提示快取
  effortValue?: EffortValue          // 推理努力級別
  mcpTools: Tools                    // MCP 工具
  fastMode?: boolean                 // 快速模式
  taskBudget?: { total: number; remaining?: number }  // 令牌預算
}
```

### 3.4 queryModel() 核心流程（第 1018 行）

這是整個 API 呼叫的核心，2400 行。關鍵步驟：

#### 階段 1：前置準備（1018-1400 行）

```
queryModel()
  ├── off-switch 檢查（Opus 過載時的全局關閉開關）
  ├── beta headers 組裝（getMergedBetas）
  │   ├── 基礎 betas
  │   ├── advisor beta（如果啓用）
  │   ├── tool search beta（如果啓用）
  │   ├── cache scope beta
  │   └── effort / task budget betas
  │
  ├── 工具過濾
  │   ├── tool search 啓用 → 只包含已發現的 deferred tools
  │   └── tool search 未啓用 → 過濾掉 ToolSearchTool
  │
  ├── toolToAPISchema() — 每個工具轉爲 API 格式
  │
  ├── normalizeMessagesForAPI() — 訊息轉換爲 API 格式
  │   ├── UserMessage → { role: 'user', content: ... }
  │   ├── AssistantMessage → { role: 'assistant', content: ... }
  │   └── 跳過 system/attachment/progress 等內部訊息類型
  │
  └── 系統提示最終組裝
      ├── getAttributionHeader(fingerprint)
      ├── getCLISyspromptPrefix()
      ├── ...systemPrompt
      └── advisor 指令（如果啓用）
```

#### 階段 2：構建請求參數 — paramsFromContext()（第 1539-1730 行）

```ts
const paramsFromContext = (retryContext: RetryContext) => {
  // ... 動態 beta headers、effort、task budget 設定 ...
  
  // 思考模式設定（adaptive 或 enabled + budget）
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
    messages: addCacheBreakpoints(messagesForAPI, ...),  // 帶快取標記的訊息
    system,                           // 系統提示塊（已構建好）
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

#### 階段 3：流式 API 呼叫（第 1779-1858 行）

```ts
// 使用 withRetry 包裝，自動處理重試
const generator = withRetry(
  () => getAnthropicClient({ maxRetries: 0, model, source: querySource }),
  async (anthropic, attempt, context) => {
    const params = paramsFromContext(context)

    // ★ 核心 API 呼叫（第 1823 行）
    // 使用 .create() + stream: true（而非 .stream()）
    // 避免 BetaMessageStream 的 O(n²) partial JSON 解析開銷
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

// 消費 withRetry 的系統錯誤訊息（重試通知等）
let e
do {
  e = await generator.next()
  if (!('controller' in e.value)) yield e.value  // yield API 錯誤訊息
} while (!e.done)
stream = e.value  // 取得最終的 Stream 對象

// 處理流式事件（第 1941 行）
for await (const part of stream) {
  switch (part.type) {
    case 'message_start':    // 記錄 request_id、usage
    case 'content_block_start':  // 新的內容塊開始（text/thinking/tool_use）
    case 'content_block_delta':  // 增量內容 → yield stream_event 給 UI
    case 'content_block_stop':   // 內容塊完成 → yield AssistantMessage
    case 'message_delta':    // stop_reason、usage 更新
    case 'message_stop':     // 整條訊息完成
  }
}
```

#### 階段 4：withRetry 重試策略

```
withRetry 邏輯:
  ├── 429 (Rate Limit) → 等待 Retry-After 後重試
  ├── 529 (Overloaded) → 切換到 fallbackModel，throw FallbackTriggeredError
  ├── 500 (Server Error) → 指數退避重試
  ├── 408 (Timeout) → 重試
  ├── 其他錯誤 → 不重試，直接拋出
  └── 最大重試次數: 根據模型和錯誤類型動態計算
```

#### 階段 5：非流式降級

當流式請求中途失敗時，可能降級爲非流式請求：

```
流式失敗（部分響應已收到）:
  ├── 已接收的內容 → yield 給上層
  ├── 剩餘部分 → 降級爲非流式請求（anthropic.beta.messages.create）
  └── 非流式結果 → 轉換格式 yield
```

### 3.5 訊息轉換函數

```ts
// UserMessage → API 格式
userMessageToMessageParam(message, addCache, enablePromptCaching, querySource)
  → { role: 'user', content: [...] }
  // addCache=true 時最後一個 content block 添加 cache_control

// AssistantMessage → API 格式
assistantMessageToMessageParam(message, addCache, enablePromptCaching, querySource)
  → { role: 'assistant', content: [...] }
  // thinking/redacted_thinking 塊不加 cache_control
```

### 3.6 Prompt Caching 策略

```
快取策略:
  ├── cache_control: { type: 'ephemeral' }  — 預設，5 分鐘 TTL
  ├── cache_control: { type: 'ephemeral', ttl: '1h' }  — 訂閱用戶/Ant，1 小時
  ├── cache_control: { ..., scope: 'global' }  — 跨會話共享（無 MCP 工具時）
  └── 禁用條件：
      ├── DISABLE_PROMPT_CACHING 環境變量
      ├── DISABLE_PROMPT_CACHING_HAIKU（僅 Haiku）
      └── DISABLE_PROMPT_CACHING_SONNET（僅 Sonnet）
```

### 3.7 多 Provider 支援

`getAnthropicClient()` 根據設定返回不同的 SDK 客戶端：

| Provider | 入口 | 說明 |
|----------|------|------|
| Anthropic | 直接 API | 預設，`api.anthropic.com` |
| AWS Bedrock | 通過 Bedrock | 使用 `@anthropic-ai/bedrock-sdk` |
| Google Vertex | 通過 Vertex | 使用 `@anthropic-ai/vertex-sdk` |
| Azure | 通過 Azure | 類似 Bedrock 的包裝 |

Provider 選擇邏輯在 `src/utils/model/providers.ts` 的 `getAPIProvider()` 中。

---

## 完整資料流：一次工具呼叫的生命週期

以用戶輸入 "讀取 README.md" 爲例：

```
1. REPL.tsx: 用戶按回車
   onSubmit("讀取 README.md")
     └── handlePromptSubmit()
           └── onQuery([userMessage])

2. REPL.tsx: onQueryImpl()
   ├── getSystemPrompt() + getUserContext() + getSystemContext()
   └── for await (event of query({messages, systemPrompt, ...}))

3. query.ts: queryLoop() — 第 1 次迭代
   ├── messagesForQuery = [...messages]  // 包含用戶訊息
   ├── deps.callModel({...})
   │     └── claude.ts: queryModel()
   │           ├── 構建 API 參數
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
   ├── 工具執行:
   │   streamingToolExecutor.getRemainingResults()
   │     └── Read 工具執行 → 返回檔案內容
   │   yield toolResultMessage  ← 包含檔案內容
   │
   └── state = { messages: [...old, assistantMsg, toolResultMsg], turnCount: 2 }
       → continue

4. query.ts: queryLoop() — 第 2 次迭代
   ├── messagesForQuery 現在包含:
   │   [userMsg, assistantMsg(tool_use), userMsg(tool_result)]
   │
   ├── deps.callModel({...})  ← 再次呼叫 API
   │
   ├── API 返回:
   │   content_block_start: { type: 'text' }
   │   content_block_delta: { text: "README.md 的內容是..." }
   │   content_block_stop
   │   message_delta: { stop_reason: 'end_turn' }
   │
   ├── toolUseBlocks = []  ← 沒有工具呼叫
   ├── needsFollowUp = false
   │
   └── return { reason: 'completed' }  ★ 循環結束

5. REPL.tsx: onQueryEvent(event)
   ├── 更新 streamingText（打字機效果）
   ├── 更新 messages 數組
   └── 重新渲染 UI
```

---

## 關鍵設計模式總結

| 模式 | 位置 | 說明 |
|------|------|------|
| AsyncGenerator 鏈式傳遞 | query.ts → claude.ts | `yield*` 將底層事件透傳給上層，形成事件流管道 |
| while(true) + State 對象 | query.ts queryLoop | 循環迭代間通過不可變 State 傳遞，transition 字段記錄原因 |
| StreamingToolExecutor | query.ts | API 流式返回時並行執行工具，不等流結束 |
| Withheld 訊息 | query.ts | 可恢復錯誤先暫扣不 yield，恢復成功則吞掉錯誤 |
| withRetry 重試 | claude.ts | 429/500/529 自動重試，529 觸發模型降級 |
| Prompt Caching | claude.ts | 快取系統提示和歷史訊息，減少 API token 消耗 |
| 非流式降級 | claude.ts | 流式請求中途失敗時降級爲非流式完成剩餘部分 |
| QueryEngine 包裝 | QueryEngine.ts | 爲 SDK/print 提供會話管理、持久化、usage 跟蹤 |

## 需要忽略的程式碼

| 模式 | 說明 |
|------|------|
| `feature('REACTIVE_COMPACT')` / `feature('CONTEXT_COLLAPSE')` 等 | 所有 feature flag 保護的程式碼 — 全部是死程式碼 |
| `feature('CACHED_MICROCOMPACT')` | 快取微壓縮 — 死程式碼 |
| `feature('HISTORY_SNIP')` / `snipModule` | 歷史截斷 — 死程式碼 |
| `feature('TOKEN_BUDGET')` / `budgetTracker` | 令牌預算 — 死程式碼 |
| `feature('BG_SESSIONS')` / `taskSummaryModule` | 後臺會話 — 死程式碼 |
| `process.env.USER_TYPE === 'ant'` | Anthropic 內部專用程式碼 |
| VCR (withStreamingVCR/withVCR) | 調試錄像/回放包裝器，不影響正常流程 |
