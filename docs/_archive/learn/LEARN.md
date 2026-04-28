# Claude Code 源碼學習路線

> 基於反編譯版 Claude Code CLI (v2.1.888) 的源碼學習跟蹤
>
> 各階段詳細筆記見同目錄下的 `phase-*.md` 文件

## 第一階段：啓動流程（入口鏈路） ✅

詳細筆記：[phase-1-startup-flow.md](phase-1-startup-flow.md)

理解程式從命令列啓動到用戶看到互動介面的完整路徑。

- [x] `src/entrypoints/cli.tsx` — 真正入口，polyfill 注入 + 快速路徑分發
  - [x] 全局 polyfill：`feature()` 永遠返回 false、`MACRO` 全局對象、`BUILD_*` 常量
  - [x] 快速路徑設計：按開銷從低到高檢查，能早返回就早返回
  - [x] 動態 import 模式：`await import()` 延遲加載，減少啓動時間
  - [x] 最終出口：`import("../main.jsx")` → `cliMain()`
- [x] `src/main.tsx` — Commander.js CLI 定義，重型初始化（4683 行）
  - [x] 三段式結構：輔助函數(1-584) → main()(585-856) → run()(884-4683)
  - [x] side-effect import：profileCheckpoint、startMdmRawRead、startKeychainPrefetch 並行預加載
  - [x] preAction 鉤子：MDM 等待、init()、遷移、遠程設置
  - [x] Commander 參數定義：40+ CLI 選項
  - [x] action handler（2800 行）：參數解析 → 服務初始化 → showSetupScreens → launchRepl()
  - [x] --print 分支走 print.ts；交互分支走 launchRepl()（7 個場景分支）
  - [x] 子命令註冊：mcp/auth/plugin/doctor/update/install 等
- [x] `src/replLauncher.tsx` — 橋樑（22 行），組合 `<App>` + `<REPL>` 渲染到終端
- [x] `src/screens/REPL.tsx` — 交互式 REPL 界面（5009 行）
  - [x] Props：commands、tools、messages、systemPrompt、thinkingConfig 等
  - [x] 50+ 狀態：messages、inputValue、screen、streamingText、queryGuard 等
  - [x] 核心資料流：onSubmit → handlePromptSubmit → onQuery → onQueryImpl → query() → onQueryEvent
  - [x] QueryGuard 併發控制：idle → running → idle，防止重複查詢
  - [x] 渲染：Transcript 模式（只讀歷史）/ Prompt 模式（Messages + PermissionRequest + PromptInput）

**資料流**：`bun run dev` → `package.json scripts.dev` → `bun run src/entrypoints/cli.tsx` → 快速路徑檢查 → `main.tsx:main()` → `launchRepl()` → `<App><REPL /></App>`

---

## 第二階段：核心對話循環 ✅

詳細筆記：[phase-2-conversation-loop.md](phase-2-conversation-loop.md)

理解用戶發一句話後，如何變成 API 請求、如何處理流式響應和工具呼叫。

- [x] `src/query.ts` — 核心查詢循環（1732 行）
  - [x] `query()` AsyncGenerator 入口，委託給 `queryLoop()`
  - [x] `queryLoop()` — while(true) 主循環，State 對象管理迭代狀態
  - [x] 訊息預處理（autocompact、compact boundary）
  - [x] `deps.callModel()` → 流式 API 呼叫
  - [x] StreamingToolExecutor — API 流式返回時並行執行工具
  - [x] 工具呼叫循環（tool use → 執行 → result → continue）
  - [x] 錯誤恢復（prompt-too-long、max_output_tokens 升級+多輪恢復）
  - [x] 模型降級（FallbackTriggeredError → 切換 fallbackModel）
  - [x] Withheld 訊息模式（暫扣可恢復錯誤）
- [x] `src/QueryEngine.ts` — 高層編排器（1320 行）
  - [x] QueryEngine 類 — 一個 conversation 一個實例
  - [x] `submitMessage()` — 處理用戶輸入 → 呼叫 `query()` → 消費事件流
  - [x] SDK/print 模式專用（REPL 直接呼叫 query()）
  - [x] 會話持久化（recordTranscript）
  - [x] Usage 跟蹤、權限拒絕記錄
  - [x] `ask()` 便捷包裝函數
- [x] `src/services/api/claude.ts` — API 客戶端（3420 行）
  - [x] `queryModelWithStreaming` / `queryModelWithoutStreaming` — 兩個公開入口
  - [x] `queryModel()` — 核心私有函數（2400 行）
  - [x] 請求參數組裝（system prompt、betas、tools、cache control）
  - [x] Anthropic SDK 流式呼叫（`anthropic.beta.messages.stream()`）
  - [x] `BetaRawMessageStreamEvent` 事件處理（message_start/content_block_*/message_delta/stop）
  - [x] withRetry 重試策略（429/500/529 + 模型降級）
  - [x] Prompt Caching 策略（ephemeral/1h TTL/global scope）
  - [x] 多 provider 支援（Anthropic / Bedrock / Vertex / Azure）

**資料流**：REPL.onSubmit → handlePromptSubmit → onQuery → onQueryImpl → `query()` AsyncGenerator → `queryLoop()` while(true) → `deps.callModel()` → `claude.ts queryModel()` → `anthropic.beta.messages.stream()` → 流式事件 → 收集 tool_use → 執行工具 → 結果追加到 messages → continue → 無工具呼叫時 return

---

## 第三階段：工具系統

理解 Claude 如何定義、註冊、呼叫工具。先讀框架，再挑具體工具。

- [ ] `src/Tool.ts` — Tool 介面定義
  - [ ] `Tool` 類型結構（name、description、inputSchema、call）
  - [ ] `findToolByName`、`toolMatchesName` 工具函數
- [ ] `src/tools.ts` — 工具註冊表
  - [ ] 工具列表組裝邏輯
  - [ ] 條件加載（feature flag、USER_TYPE）
- [ ] 具體工具實現（挑選 2-3 個深入閱讀）：
  - [ ] `src/tools/BashTool/` — 執行 shell 命令，最常用的工具
  - [ ] `src/tools/FileReadTool/` — 讀取文件，簡單直觀，適合理解工具模式
  - [ ] `src/tools/FileEditTool/` — 編輯文件，理解 diff/patch 機制
  - [ ] `src/tools/AgentTool/` — 子 Agent 機制，較複雜但核心

---

## 第四階段：上下文與系統提示

理解 Claude 如何"知道"專案信息、用戶偏好等上下文。

- [ ] `src/context.ts` — 系統/用戶上下文構建
  - [ ] git 狀態注入
  - [ ] CLAUDE.md 內容加載
  - [ ] 內存文件（memory）注入
  - [ ] 日期、平臺等環境信息
- [ ] `src/utils/claudemd.ts` — CLAUDE.md 發現與加載
  - [ ] 專案層級搜索邏輯
  - [ ] 多級 CLAUDE.md 合併

---

## 第五階段：UI 層（按興趣選讀）

理解終端 UI 的渲染機制（React/Ink）。

- [ ] `src/components/App.tsx` — 根組件，Provider 注入
- [ ] `src/state/AppState.tsx` — 全局狀態類型與 Context
- [ ] `src/components/permissions/` — 工具權限審批 UI
- [ ] `src/components/messages/` — 訊息渲染組件

---

## 第六階段：外圍系統（按需探索）

- [ ] `src/services/mcp/` — MCP 協議（Model Context Protocol）
- [ ] `src/skills/` — 技能系統（/commit 等斜槓命令）
- [ ] `src/commands/` — CLI 子命令
- [ ] `src/tasks/` — 後臺任務系統
- [ ] `src/utils/model/providers.ts` — 多 provider 選擇邏輯

---

## 學習筆記

### 關鍵設計模式

| 模式 | 位置 | 說明 |
|------|------|------|
| 快速路徑 | cli.tsx | 按開銷從低到高逐級檢查，減少不必要的模組加載 |
| 動態 import | cli.tsx / main.tsx | `await import()` 延遲加載，優化啓動時間 |
| feature flag | 全局 | `feature()` 永遠返回 false，所有內部功能禁用 |
| React/Ink | UI 層 | 用 React 組件模型渲染終端 UI |
| 工具循環 | query.ts | AI 返回工具呼叫 → 執行 → 結果回傳 → 繼續，直到無工具呼叫 |
| AsyncGenerator 鏈 | query.ts → claude.ts | `yield*` 透傳事件流，形成管道 |
| State 對象 | query.ts queryLoop | 循環間通過不可變 State + transition 字段傳遞狀態 |
| StreamingToolExecutor | query.ts | API 流式返回時並行執行工具 |
| Withheld 訊息 | query.ts | 暫扣可恢復錯誤，恢復成功則吞掉 |
| withRetry | claude.ts | 429/500/529 自動重試 + 模型降級 |
| Prompt Caching | claude.ts | 快取系統提示和歷史訊息，減少 token 消耗 |

### 需要忽略的內容

- `_c()` 呼叫 — React Compiler 反編譯產物
- `feature('...')` 後面的程式碼塊 — 全部是死程式碼
- tsc 類型錯誤 — 反編譯導致，不影響 Bun 執行
- `packages/@ant/` — stub 包，無實際實現
