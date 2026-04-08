# COORDINATOR_MODE — 多 Agent 編排

> Feature Flag: `FEATURE_COORDINATOR_MODE=1` + 環境變量 `CLAUDE_CODE_COORDINATOR_MODE=1`
> 實現狀態：編排者完整可用，worker agent 爲通用 AgentTool worker
> 引用數：32

## 一、功能概述

COORDINATOR_MODE 將 CLI 變爲"編排者"角色。編排者不直接操作文件，而是通過 AgentTool 派發任務給多個 worker 並行執行。適用於大型任務拆分、並行研究、實現+驗證分離等場景。

### 核心約束

- 編排者只能使用：`Agent`（派發 worker）、`SendMessage`（繼續 worker）、`TaskStop`（停止 worker）
- Worker 可以使用所有標準工具（Bash、Read、Edit 等）+ MCP 工具 + Skill 工具
- 編排者的每條訊息都是給用戶看的；worker 結果以 `<task-notification>` XML 形式到達

## 二、用戶交互

### 啓用方式

```bash
FEATURE_COORDINATOR_MODE=1 CLAUDE_CODE_COORDINATOR_MODE=1 bun run dev
```

需要同時設置 feature flag 和環境變量。`CLAUDE_CODE_COORDINATOR_MODE` 可在會話恢復時自動切換（`matchSessionMode`）。

### 典型工作流

```
用戶: "修復 auth 模組的 null pointer"

編排者:
  1. 並行派發兩個 worker:
     - Agent({ description: "調查 auth bug", prompt: "..." })
     - Agent({ description: "研究 auth 測試", prompt: "..." })

  2. 收到 <task-notification>:
     - Worker A: "在 validate.ts:42 發現 null pointer"
     - Worker B: "測試覆蓋情況..."

  3. 綜合發現，繼續 Worker A:
     - SendMessage({ to: "agent-a1b", message: "修復 validate.ts:42..." })

  4. 收到修復結果，派發驗證:
     - Agent({ description: "驗證修復", prompt: "..." })
```

## 三、實現架構

### 3.1 模式檢測

文件：`src/coordinator/coordinatorMode.ts:36-41`

```ts
export function isCoordinatorMode(): boolean {
  return feature('COORDINATOR_MODE') &&
    isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)
}
```

### 3.2 會話模式恢復

`matchSessionMode(sessionMode)` 在恢復舊會話時檢查存儲的模式，如果當前環境變量與存儲不一致，自動翻轉環境變量。防止在普通模式下恢復編排會話（或反之）。

### 3.3 Worker 工具集

`getCoordinatorUserContext()` 告知編排者 worker 可用的工具列表：

- **標準模式**：`ASYNC_AGENT_ALLOWED_TOOLS` 排除內部工具（TeamCreate、TeamDelete、SendMessage、SyntheticOutput）
- **Simple 模式**（`CLAUDE_CODE_SIMPLE=1`）：僅 Bash、Read、Edit
- **MCP 工具**：列出已連接的 MCP 服務器名稱
- **Scratchpad**：如果 GrowthBook `tengu_scratch` 啓用，提供跨 worker 共享的 scratchpad 目錄

### 3.4 系統提示

文件：`src/coordinator/coordinatorMode.ts:111-369`

編排者系統提示（`getCoordinatorSystemPrompt()`）約 370 行，包含：

| 章節 | 內容 |
|------|------|
| 1. Your Role | 編排者職責定義 |
| 2. Your Tools | Agent/SendMessage/TaskStop 使用說明 |
| 3. Workers | Worker 能力和限制 |
| 4. Task Workflow | Research → Synthesis → Implementation → Verification 流程 |
| 5. Writing Worker Prompts | 自包含 prompt 編寫指南 + 好壞示例對比 |
| 6. Example Session | 完整示例對話 |

### 3.5 Worker Agent

文件：`src/coordinator/workerAgent.ts`

當前爲 stub。Worker 實際使用通用 AgentTool 的 `worker` subagent_type。

### 3.6 資料流

```
用戶訊息
      │
      ▼
編排者 REPL（受限工具集）
      │
      ├──→ Agent({ subagent_type: "worker", prompt: "..." })
      │         │
      │         ▼
      │    Worker Agent（完整工具集）
      │    ├── 執行任務（Bash/Read/Edit/...）
      │    └── 返回 <task-notification>
      │
      ├──→ SendMessage({ to: "agent-id", message: "..." })
      │         │
      │         ▼
      │    繼續已存在的 Worker
      │
      └──→ TaskStop({ task_id: "agent-id" })
                │
                ▼
           停止執行中的 Worker
```

## 四、關鍵設計決策

1. **雙開關設計**：feature flag 控制程式碼可用性，環境變量控制實際激活。允許編譯時包含但不預設啓用
2. **編排者受限**：只能用 Agent/SendMessage/TaskStop，確保編排者專注於派發而非執行
3. **Worker 不可見編排者對話**：每個 worker 的 prompt 必須自包含（所有必要上下文）
4. **並行優先**：系統提示強調"Parallelism is your superpower"，鼓勵並行派發獨立任務
5. **綜合而非轉發**：編排者必須理解 worker 發現，再寫出具體的實現指令。禁止 "based on your findings" 類懶惰委託
6. **Scratchpad 可選共享**：通過 GrowthBook 門控的共享目錄，讓 worker 之間持久化共享知識

## 五、使用方式

```bash
# 基本啓用
FEATURE_COORDINATOR_MODE=1 CLAUDE_CODE_COORDINATOR_MODE=1 bun run dev

# 配合 Fork Subagent
FEATURE_COORDINATOR_MODE=1 FEATURE_FORK_SUBAGENT=1 \
CLAUDE_CODE_COORDINATOR_MODE=1 bun run dev

# Simple 模式（worker 只有 Bash/Read/Edit）
FEATURE_COORDINATOR_MODE=1 CLAUDE_CODE_COORDINATOR_MODE=1 \
CLAUDE_CODE_SIMPLE=1 bun run dev
```

## 六、檔案索引

| 文件 | 行數 | 職責 |
|------|------|------|
| `src/coordinator/coordinatorMode.ts` | 370 | 模式檢測 + 系統提示 + 用戶上下文 |
| `src/coordinator/workerAgent.ts` | — | Worker agent 定義（stub） |
| `src/constants/tools.ts` | — | `ASYNC_AGENT_ALLOWED_TOOLS` 工具白名單 |
