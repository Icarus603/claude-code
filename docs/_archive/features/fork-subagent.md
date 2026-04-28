# FORK_SUBAGENT — 上下文繼承子 Agent

> Feature Flag: `FEATURE_FORK_SUBAGENT=1`
> 實現狀態：完整可用
> 引用數：4

## 一、功能概述

FORK_SUBAGENT 讓 AgentTool 生成"fork 子 agent"，繼承父級完整對話上下文。子 agent 看到父級的所有歷史訊息、工具集和系統提示，並且與父級共享 API 請求前綴以最大化 prompt cache 命中率。

### 核心優勢

- **Prompt Cache 最大化**：多個並行 fork 共享相同的 API 請求前綴，只有最後的 directive 文本塊不同
- **上下文完整性**：子 agent 繼承父級的完整對話歷史（包括 thinking config）
- **權限冒泡**：子 agent 的權限提示上浮到父級終端顯示
- **Worktree 隔離**：支援 git worktree 隔離，子 agent 在獨立分支工作

## 二、用戶交互

### 觸發方式

當 `FORK_SUBAGENT` 啓用時，AgentTool 呼叫不指定 `subagent_type` 時自動走 fork 路徑：

```
// Fork 路徑（繼承上下文）
Agent({ prompt: "修復這個 bug" })  // 無 subagent_type

// 普通 agent 路徑（全新上下文）
Agent({ subagent_type: "general-purpose", prompt: "..." })
```

### /fork 命令

註冊了 `/fork` 斜槓命令（當前爲 stub）。當 FORK_SUBAGENT 開啓時，`/branch` 命令失去 `fork` 別名，避免衝突。

## 三、實現架構

### 3.1 門控與互斥

文件：`src/tools/AgentTool/forkSubagent.ts:32-39`

```ts
export function isForkSubagentEnabled(): boolean {
  if (feature('FORK_SUBAGENT')) {
    if (isCoordinatorMode()) return false   // Coordinator 有自己的委派模型
    if (getIsNonInteractiveSession()) return false  // pipe/SDK 模式禁用
    return true
  }
  return false
}
```

### 3.2 FORK_AGENT 定義

```ts
export const FORK_AGENT = {
  agentType: 'fork',
  tools: ['*'],              // 通配符：使用父級完整工具集
  maxTurns: 200,
  model: 'inherit',          // 繼承父級模型
  permissionMode: 'bubble',  // 權限冒泡到父級終端
  getSystemPrompt: () => '', // 不使用：直接傳遞父級已渲染 prompt
}
```

### 3.3 核心呼叫流程

```
AgentTool.call({ prompt, name })
      │
      ▼
isForkSubagentEnabled() && !subagent_type?
      │
      ├── No → 普通 agent 路徑
      │
      └── Yes → Fork 路徑
            │
            ▼
      遞歸防護檢查
      ├── querySource === 'agent:builtin:fork' → 拒絕
      └── isInForkChild(messages) → 拒絕
            │
            ▼
      取得父級 system prompt
      ├── toolUseContext.renderedSystemPrompt（首選）
      └── buildEffectiveSystemPrompt（回退）
            │
            ▼
      buildForkedMessages(prompt, assistantMessage)
      ├── 克隆父級 assistant 訊息
      ├── 生成佔位符 tool_result
      └── 附加 directive 文本塊
            │
            ▼
      [可選] buildWorktreeNotice()
            │
            ▼
      runAgent({
        useExactTools: true,
        override.systemPrompt: 父級,
        forkContextMessages: 父級訊息,
        availableTools: 父級工具,
      })
```

### 3.4 訊息構建：buildForkedMessages

文件：`src/tools/AgentTool/forkSubagent.ts:107-169`

構建的訊息結構：

```
[
  ...history (filterIncompleteToolCalls),  // 父級完整歷史
  assistant(所有 tool_use 塊),              // 父級當前 turn 的 assistant 訊息
  user(
    佔位符 tool_result × N +               // 相同佔位符文本
    <fork-boilerplate> directive           // 每個 fork 不同
  )
]
```

**所有 fork 使用相同的佔位符文本**：`"Fork started — processing in background"`。這確保多個並行 fork 的 API 請求前綴完全一致，最大化 prompt cache 命中。

### 3.5 遞歸防護

兩層檢查防止 fork 嵌套：

1. **querySource 檢查**：`toolUseContext.options.querySource === 'agent:builtin:fork'`。在 `context.options` 上設置，抗自動壓縮（autocompact 只重寫訊息不改 options）
2. **訊息掃描**：`isInForkChild()` 掃描訊息歷史中的 `<fork-boilerplate>` 標籤

### 3.6 Worktree 隔離通知

當 fork + worktree 組合時，追加通知告知子 agent：

> "你繼承了父 agent 在 `{parentCwd}` 的對話上下文，但你在獨立的 git worktree `{worktreeCwd}` 中操作。路徑需要轉換，編輯前重新讀取。"

### 3.7 強制異步

當 `isForkSubagentEnabled()` 爲 true 時，所有 agent 啓動都強制異步。`run_in_background` 參數從 schema 中移除。統一通過 `<task-notification>` XML 訊息交互。

## 四、Prompt Cache 優化

這是整個 fork 設計的核心優化目標：

| 優化點 | 實現 |
|--------|------|
| **相同 system prompt** | 直傳 `renderedSystemPrompt`，避免重新渲染（GrowthBook 狀態可能不一致） |
| **相同工具集** | `useExactTools: true` 直接使用父級工具，不經過 `resolveAgentTools` 過濾 |
| **相同 thinking config** | 繼承父級 thinking 設定（非 fork agent 預設禁用 thinking） |
| **相同佔位符結果** | 所有 fork 使用 `FORK_PLACEHOLDER_RESULT` 相同文本 |
| **ContentReplacementState 克隆** | 預設克隆父級替換狀態，保持 wire prefix 一致 |

## 五、子 Agent 指令

`buildChildMessage()` 生成 `<fork-boilerplate>` 包裹的指令：

- 你是 fork worker，不是主 agent
- 禁止再次 spawn sub-agent（直接執行）
- 不要閒聊、不要元評論
- 直接使用工具
- 修改文件後要 commit，報告 commit hash
- 報告格式：`Scope:` / `Result:` / `Key files:` / `Files changed:` / `Issues:`

## 六、關鍵設計決策

1. **Fork ≠ 普通 agent**：fork 繼承完整上下文，普通 agent 從零開始。選擇依據是 `subagent_type` 是否存在
2. **renderedSystemPrompt 直傳**：避免 fork 時重新呼叫 `getSystemPrompt()`。父級在 turn 開始時凍結 prompt 字節
3. **佔位符結果共享**：多個並行 fork 使用完全相同的佔位符，只有 directive 不同
4. **Coordinator 互斥**：Coordinator 模式下禁用 fork，兩者有不相容的委派模型
5. **非交互式禁用**：pipe 模式和 SDK 模式下禁用，避免不可見的 fork 嵌套

## 七、使用方式

```bash
# 啓用 feature
FEATURE_FORK_SUBAGENT=1 bun run dev

# 在 REPL 中使用（不指定 subagent_type 即走 fork）
# Agent({ prompt: "研究這個模組的結構" })
# Agent({ prompt: "實現這個功能" })
```

## 八、檔案索引

| 文件 | 行數 | 職責 |
|------|------|------|
| `src/tools/AgentTool/forkSubagent.ts` | ~210 | 核心定義 + 訊息構建 + 遞歸防護 |
| `src/tools/AgentTool/AgentTool.tsx` | — | Fork 路由 + 強制異步 |
| `src/tools/AgentTool/prompt.ts` | — | "When to Fork" 提示詞段落 |
| `src/tools/AgentTool/runAgent.ts` | — | useExactTools 路徑 |
| `src/tools/AgentTool/resumeAgent.ts` | — | Fork agent 恢復 |
| `src/constants/xml.ts` | — | XML 標籤常量 |
| `src/utils/forkedAgent.ts` | — | CacheSafeParams + ContentReplacementState 克隆 |
| `src/commands/fork/index.ts` | — | /fork 命令（stub） |
