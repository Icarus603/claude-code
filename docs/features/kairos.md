# KAIROS — 常駐助手模式

> Feature Flag: `FEATURE_KAIROS=1`（及子 Feature）
> 實現狀態：核心框架完整，部分子模組爲 stub
> 引用數：154（全庫最大）

## 一、功能概述

KAIROS 將 Claude Code CLI 從"問答工具"轉變爲"常駐助手"。開啓後，CLI 持續執行在後臺，支援：

- **持久化 bridge 會話**：跨終端重啓複用 session，通過 Anthropic OAuth 連接 claude.ai
- **後臺執行任務**：用戶離開終端時繼續工作（配合 PROACTIVE feature）
- **推送通知到移動端**：任務完成或需要輸入時推送（配合 `KAIROS_PUSH_NOTIFICATION`）
- **每日記憶日誌**：自動記錄和回顧工作內容（配合 `KAIROS_DREAM`）
- **外部頻道訊息接入**：Slack/Discord/Telegram 訊息轉發到 CLI（配合 `KAIROS_CHANNELS`）
- **結構化 Brief 輸出**：通過 BriefTool 輸出結構化訊息（配合 `KAIROS_BRIEF`）

### 子 Feature 依賴關係

```
KAIROS (主開關)
├── KAIROS_BRIEF (BriefTool, 結構化輸出)
├── KAIROS_CHANNELS (外部頻道訊息)
├── KAIROS_PUSH_NOTIFICATION (移動端推送)
├── KAIROS_GITHUB_WEBHOOKS (GitHub PR webhook)
└── KAIROS_DREAM (記憶蒸餾)
```

**注意**：PROACTIVE 與 KAIROS 強綁定。所有程式碼檢查都是 `feature('PROACTIVE') || feature('KAIROS')`，即 KAIROS 開啓時自動獲得 proactive 能力。

## 二、系統提示

KAIROS 在系統提示中注入兩大段落：

### 2.1 Brief 段落 (`getBriefSection`)

文件：`src/constants/prompts.ts:843-858`

當 `feature('KAIROS') || feature('KAIROS_BRIEF')` 時注入。Brief 工具（`SendUserMessage`）的結構化訊息輸出指令。`/brief` toggle 和 `--brief` flag 只控制顯示過濾，不影響模型行爲。

### 2.2 Proactive/Autonomous Work 段落 (`getProactiveSection`)

文件：`src/constants/prompts.ts:860-914`

當 `feature('PROACTIVE') || feature('KAIROS')` 且 `isProactiveActive()` 時注入。核心行爲指令：

- **Tick 驅動**：通過 `<tick_tag>` prompt 保持存活，每個 tick 包含用戶當前本地時間
- **節奏控制**：使用 `SleepTool` 控制等待間隔（prompt cache 5 分鐘過期）
- **空操作時必須 Sleep**：禁止輸出 "still waiting" 類文本（浪費 turn 和 token）
- **偏向行動**：讀文件、搜索程式碼、修改文件、commit — 都不需詢問
- **終端焦點感知**：`terminalFocus` 字段指示用戶是否在看終端
  - Unfocused → 高度自主行動
  - Focused → 更協作，展示選擇

## 三、實現架構

### 3.1 核心模組

| 模組 | 文件 | 狀態 | 職責 |
|------|------|------|------|
| Assistant 入口 | `src/assistant/index.ts` | Stub | `isAssistantMode()`、`initializeAssistantTeam()` |
| Session 發現 | `src/assistant/sessionDiscovery.ts` | Stub | 發現可用 bridge session |
| Session 歷史 | `src/assistant/sessionHistory.ts` | Stub | 持久化 session 歷史 |
| Gate 控制 | `src/assistant/gate.ts` | Stub | GrowthBook 門控檢查 |
| Session 選擇器 | `src/assistant/AssistantSessionChooser.ts` | Stub | UI 選擇 session |
| BriefTool | `src/tools/BriefTool/` | Stub | 結構化訊息輸出工具 |
| Channel Notification | `src/services/mcp/channelNotification.ts` | Stub | 外部頻道訊息接入 |
| Dream Task | `src/components/tasks/src/tasks/DreamTask/` | Stub | 記憶蒸餾任務 |
| Memory Directory | `src/memdir/memdir.ts` | Stub | 記憶目錄管理 |

### 3.2 SleepTool（與 Proactive 共享）

文件：`src/tools/SleepTool/prompt.ts`

SleepTool 是 KAIROS/Proactive 的節奏控制核心。工具描述讓模型理解"休眠"概念：
- 工具名：`Sleep`
- 功能：等待指定時間後響應 tick prompt
- 與 `<tick_tag>` 配合實現心跳式自主工作

### 3.3 Bridge 集成

KAIROS 通過 Bridge Mode（`src/bridge/`）連接到 claude.ai 服務器：

```
claude.ai web/app
      │
      ▼ (HTTPS long-poll)
┌──────────────────────┐
│  Bridge API Client   │  src/bridge/bridgeApi.ts
│  (register/poll/     │
│   acknowledge)       │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Session Runner      │  src/bridge/sessionRunner.ts
│  (建立/恢復 REPL)     │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  REPL + Proactive    │  Tick 驅動自主工作
│  Tick Loop           │
└──────────────────────┘
```

### 3.4 資料流

```
用戶從 claude.ai 發送訊息
         │
         ▼
Bridge pollForWork() 收到 WorkResponse
         │
         ▼
acknowledgeWork() 確認接收
         │
         ▼
sessionRunner 建立/恢復 REPL session
         │
         ▼
用戶訊息注入到 REPL 對話
         │
         ▼
模型處理 → 工具呼叫 → BriefTool 結構化輸出
         │
         ▼
結果通過 Bridge API 回傳到 claude.ai
```

## 四、關鍵設計決策

1. **Tick 驅動而非事件驅動**：模型通過 SleepTool 自行控制喚醒頻率，而非外部事件推送。簡化架構但增加 API 呼叫開銷
2. **KAIROS ⊃ PROACTIVE**：所有 proactive 檢查都包含 KAIROS，無需同時開啓兩個 flag
3. **Brief 顯示/行爲分離**：`/brief` toggle 只控制 UI 過濾，模型始終可以使用 BriefTool
4. **Terminal Focus 感知**：模型根據用戶是否在看終端自動調節自主程度
5. **GrowthBook 門控**：部分功能（如推送通知）即使 feature flag 開啓還需要服務端 GrowthBook 開關

## 五、使用方式

```bash
# 最小啓用（常駐助手 + Brief）
FEATURE_KAIROS=1 FEATURE_KAIROS_BRIEF=1 bun run dev

# 全功能啓用
FEATURE_KAIROS=1 \
FEATURE_KAIROS_BRIEF=1 \
FEATURE_KAIROS_CHANNELS=1 \
FEATURE_KAIROS_PUSH_NOTIFICATION=1 \
FEATURE_KAIROS_GITHUB_WEBHOOKS=1 \
FEATURE_PROACTIVE=1 \
bun run dev

# 配合 Token Budget 使用
FEATURE_KAIROS=1 FEATURE_TOKEN_BUDGET=1 bun run dev
```

## 六、外部依賴

- **Anthropic OAuth**：必須使用 claude.ai 訂閱登錄（非 API key）
- **GrowthBook**：服務端特性門控（`tengu_ccr_bridge` 等）
- **Bridge API**：`/v1/environments/bridge` 系列端點

## 七、檔案索引

| 文件 | 行數 | 職責 |
|------|------|------|
| `src/assistant/index.ts` | 9 | Assistant 模組入口（stub） |
| `src/assistant/gate.ts` | — | GrowthBook 門控（stub） |
| `src/assistant/sessionDiscovery.ts` | — | Session 發現（stub） |
| `src/assistant/sessionHistory.ts` | — | Session 歷史（stub） |
| `src/assistant/AssistantSessionChooser.ts` | — | Session 選擇 UI（stub） |
| `src/tools/BriefTool/` | — | BriefTool 實現（stub） |
| `src/tools/SleepTool/prompt.ts` | ~30 | SleepTool 工具提示 |
| `src/services/mcp/channelNotification.ts` | 5 | 頻道訊息接入（stub） |
| `src/memdir/memdir.ts` | — | 記憶目錄管理（stub） |
| `src/constants/prompts.ts:552-554,843-914` | 72 | 系統提示注入 |
| `src/components/tasks/src/tasks/DreamTask/` | 3 | Dream 任務（stub） |
| `src/proactive/index.ts` | — | Proactive 核心（stub，KAIROS 共享） |
