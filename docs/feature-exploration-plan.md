# Feature 探索計劃書

> 生成日期：2026-04-02
> 程式碼庫中已識別 89 個 feature flag，本文件按實現完整度和探索價值分級，制定探索優先級和路線圖。
>
> **已完成**：BUDDY（✅ 2026-04-02）、TRANSCRIPT_CLASSIFIER / Auto Mode（✅ 2026-04-02）

---

## 一、總覽

### 按實現狀態分類

| 狀態 | 數量 | 說明 |
|------|------|------|
| 已實現/可用 | 11 | 程式碼完整，開啓 feature 後可執行（可能需要 OAuth 等外部依賴） |
| 部分實現 | 8 | 核心邏輯存在但關鍵模組爲 stub，需要補全 |
| 純 Stub | 15 | 所有函數/工具返回空值，需要從零實現 |
| N/A | 55+ | 內部基礎設施、低引用量輔助功能，或反編譯丟失過多 |

### 啓用方式

所有 feature 通過環境變量啓用：

```bash
# 單個 feature
FEATURE_BUDDY=1 bun run dev

# 多個 feature 組合
FEATURE_KAIROS=1 FEATURE_PROACTIVE=1 FEATURE_FORK_SUBAGENT=1 bun run dev
```

---

## 二、Tier 1 — 已實現/可用（優先探索）

### 2.1 KAIROS（常駐助手模式）⭐ 最高優先級

- **引用數**：154（全庫最大）
- **功能**：將 CLI 變爲常駐後臺助手，支援：
  - 持久化 bridge 會話（跨重啓複用 session）
  - 後臺執行任務（用戶離開終端時繼續工作）
  - 推送通知到移動端（任務完成/需要輸入時）
  - 每日記憶日誌 + `/dream` 知識蒸餾
  - 外部頻道訊息接入（Slack/Discord/Telegram）
- **子 Feature**：

| 子 Feature | 引用 | 功能 |
|-----------|------|------|
| `KAIROS_BRIEF` | 39 | Brief 工具（`SendUserMessage`），結構化訊息輸出 |
| `KAIROS_CHANNELS` | 19 | 外部頻道訊息接入 |
| `KAIROS_PUSH_NOTIFICATION` | 4 | 移動端推送通知 |
| `KAIROS_GITHUB_WEBHOOKS` | 3 | GitHub PR webhook 訂閱 |
| `KAIROS_DREAM` | 1 | 夜間記憶蒸餾 |

- **關鍵文件**：`src/assistant/`、`src/tools/BriefTool/`、`src/services/mcp/channelNotification.ts`、`src/memdir/memdir.ts`
- **外部依賴**：Anthropic OAuth（claude.ai 訂閱）、GrowthBook 特性門控
- **探索命令**：`FEATURE_KAIROS=1 FEATURE_KAIROS_BRIEF=1 FEATURE_PROACTIVE=1 bun run dev`

**探索步驟**：
1. 開啓 feature，觀察啓動行爲變化
2. 測試 `/assistant`、`/brief` 命令
3. 驗證 BriefTool 輸出模式
4. 嘗試頻道訊息接入
5. 測試 `/dream` 記憶蒸餾

---

### ~~2.2 TRANSCRIPT_CLASSIFIER（Auto Mode 分類器）~~ ✅ 已完成

- **引用數**：108
- **功能**：使用 LLM 對用戶意圖進行分類，實現 auto mode（自動決定工具權限）
- **狀態**：✅ prompt 模板已重建，功能完整可用（2026-04-02 完成）

---

### 2.3 VOICE_MODE（語音輸入）

- **引用數**：46
- **功能**：按鍵說話（Push-to-Talk），音頻流式傳輸到 Anthropic STT 端點（Nova 3），實時轉錄顯示
- **當前狀態**：**完整實現**，包括錄音、WebSocket 流、轉錄插入
- **關鍵文件**：`src/voice/voiceModeEnabled.ts`、`src/hooks/useVoice.ts`、`src/services/voiceStreamSTT.ts`
- **外部依賴**：Anthropic OAuth（非 API key）、macOS 原生音頻或 SoX
- **探索命令**：`FEATURE_VOICE_MODE=1 bun run dev`
- **預設快捷鍵**：長按空格鍵錄音

**探索步驟**：
1. 確認 OAuth token 可用
2. 測試按住空格錄音 → 釋放後轉錄
3. 驗證實時中間轉錄顯示
4. 測試 `/voice` 命令切換

---

### 2.4 TEAMMEM（團隊共享記憶）

- **引用數**：51
- **功能**：基於 GitHub 倉庫的團隊共享記憶系統，`memory/team/` 目錄雙向同步到 Anthropic 服務器
- **當前狀態**：**完整實現**，包括增量同步、衝突解決、密鑰掃描、路徑穿越防護
- **關鍵文件**：`src/services/teamMemorySync/`（index、watcher、secretScanner）、`src/memdir/teamMemPaths.ts`
- **外部依賴**：Anthropic OAuth + GitHub remote（`getGithubRepo()`）
- **探索命令**：`FEATURE_TEAMMEM=1 bun run dev`

**探索步驟**：
1. 確認專案有 GitHub remote
2. 開啓後觀察 `memory/team/` 目錄建立
3. 測試團隊記憶寫入和同步
4. 驗證密鑰掃描防護

---

### 2.5 COORDINATOR_MODE（多 Agent 編排）

- **引用數**：32
- **功能**：CLI 變爲編排者，通過 AgentTool 派發任務給多個 worker 並行執行
- **當前狀態**：核心邏輯實現，worker agent 模組爲 stub
- **關鍵文件**：`src/coordinator/coordinatorMode.ts`（系統 prompt 完整）、`src/coordinator/workerAgent.ts`（stub）
- **限制**：編排者只能使用 AgentTool/TaskStop/SendMessage，不能直接操作文件
- **探索命令**：`FEATURE_COORDINATOR_MODE=1 CLAUDE_CODE_COORDINATOR_MODE=1 bun run dev`

**探索步驟**：
1. 補全 `workerAgent.ts` stub
2. 測試多 worker 並行任務派發
3. 驗證 worker 結果彙總

---

### 2.6 BRIDGE_MODE（遠程控制）

- **引用數**：28
- **功能**：本地 CLI 註冊爲 bridge 環境，可從 claude.ai 或其他控制面遠程驅動
- **當前狀態**：v1（env-based）和 v2（env-less）實現均存在
- **關鍵文件**：`src/bridge/bridgeEnabled.ts`、`src/bridge/replBridge.ts`（v1）、`src/bridge/remoteBridgeCore.ts`（v2）
- **外部依賴**：claude.ai OAuth、GrowthBook 門控 `tengu_ccr_bridge`
- **探索命令**：`FEATURE_BRIDGE_MODE=1 bun run dev`

---

### 2.7 FORK_SUBAGENT（上下文繼承子 Agent）

- **引用數**：4
- **功能**：AgentTool 生成 fork 子 agent，繼承父級完整對話上下文，優化 prompt cache
- **當前狀態**：**完整實現**（`forkSubagent.ts`），支援 worktree 隔離通知、遞歸防護
- **關鍵文件**：`src/tools/AgentTool/forkSubagent.ts`
- **探索命令**：`FEATURE_FORK_SUBAGENT=1 bun run dev`

---

### 2.8 TOKEN_BUDGET（Token 預算控制）

- **引用數**：9
- **功能**：解析用戶指定的 token 預算（如 "spend 2M tokens"），自動持續工作直到達到目標
- **當前狀態**：解析器**完整實現**，支援簡寫和詳細語法；QueryEngine 中的週轉邏輯已連接
- **關鍵文件**：`src/utils/tokenBudget.ts`、`src/QueryEngine.ts`
- **探索命令**：`FEATURE_TOKEN_BUDGET=1 bun run dev`

---

### 2.9 MCP_SKILLS（MCP 技能發現）

- **引用數**：9
- **功能**：將 MCP 服務器提供的 prompt 類型命令篩選爲可呼叫技能
- **當前狀態**：**功能性實現**（config 門控篩選器）
- **關鍵文件**：`src/commands.ts`（`getMcpSkillCommands()`）
- **探索命令**：`FEATURE_MCP_SKILLS=1 bun run dev`

---

### 2.10 TREE_SITTER_BASH（Bash AST 解析）

- **引用數**：3
- **功能**：純 TypeScript bash 命令 AST 解析器，用於 fail-closed 權限匹配
- **當前狀態**：**完整實現**（`bashParser.ts` ~2000行 + `ast.ts` ~400行）
- **關鍵文件**：`src/utils/vendor/tree-sitter-bash/`
- **探索命令**：`FEATURE_TREE_SITTER_BASH=1 bun run dev`

---

### ~~2.11 BUDDY（虛擬夥伴）~~ ✅ 已完成

- **引用數**：16
- **功能**：`/buddy` 命令，支援 hatch/rehatch/pet/mute/unmute
- **狀態**：✅ 已合入，功能完整可用（2026-04-02 完成）

---

## 三、Tier 2 — 部分實現（需要補全）

### 3.1 PROACTIVE（主動模式）

- **引用數**：37
- **功能**：Tick 驅動的自主代理，定時喚醒執行工作，配合 SleepTool 控制節奏
- **當前狀態**：核心模組 `src/proactive/index.ts` **全部 stub**（activate/deactivate/pause 返回 false 或空操作）
- **依賴**：與 KAIROS 強綁定（所有檢查都是 `feature('PROACTIVE') || feature('KAIROS')`）
- **補全工作量**：中等 — 需要實現 tick 生成、SleepTool 集成、暫停/恢復邏輯

### 3.2 BASH_CLASSIFIER（Bash 命令分類器）

- **引用數**：45
- **功能**：LLM 驅動的 bash 命令意圖分類（允許/拒絕/詢問）
- **當前狀態**：`bashClassifier.ts` **全部 stub**（`matches: false`）
- **補全工作量**：大 — 需要 LLM 呼叫實現、prompt 設計

### 3.3 ULTRAPLAN（增強規劃）

- **引用數**：10
- **功能**：關鍵字觸發增強計劃模式，輸入 "ultraplan" 自動轉爲 plan
- **當前狀態**：關鍵字檢測**完整實現**，`/ultraplan` 命令**爲 stub**
- **補全工作量**：小 — 只需實現命令處理邏輯

### 3.4 EXPERIMENTAL_SKILL_SEARCH（技能語義搜索）

- **引用數**：21
- **功能**：DiscoverSkills 工具，根據當前任務語義搜索可用技能
- **當前狀態**：佈線完整，核心搜索邏輯 stub
- **補全工作量**：中等 — 需要實現搜索引擎和索引

### 3.5 CONTEXT_COLLAPSE（上下文摺疊）

- **引用數**：20
- **功能**：CtxInspectTool 讓模型內省上下文窗口大小，優化壓縮決策
- **當前狀態**：工具 stub，HISTORY_SNIP 子功能也 stub
- **補全工作量**：中等

### 3.6 WORKFLOW_SCRIPTS（工作流自動化）

- **引用數**：10
- **功能**：基於文件的自動化工作流 + `/workflows` 命令
- **當前狀態**：WorkflowTool、命令、加載器全部 stub
- **補全工作量**：大 — 需要從零設計工作流 DSL

### 3.7 WEB_BROWSER_TOOL（瀏覽器工具）

- **引用數**：4
- **功能**：模型可呼叫瀏覽器工具導航和交互網頁
- **當前狀態**：工具註冊存在，實現 stub
- **補全工作量**：大

### 3.8 DAEMON（後臺守護進程）

- **引用數**：3
- **功能**：後臺守護進程 + 遠程控制服務器
- **當前狀態**：只有條件導入佈線，無實現
- **補全工作量**：極大

---

## 四、Tier 3 — 純 Stub / N/A（低優先級）

| Feature | 引用 | 狀態 | 說明 |
|---------|------|------|------|
| CHICAGO_MCP | 16 | N/A | Anthropic 內部 MCP 基礎設施 |
| UDS_INBOX | 17 | Stub | Unix 域套接字對等訊息 |
| MONITOR_TOOL | 13 | Stub | 文件/進程監控工具 |
| BG_SESSIONS | 11 | Stub | 後臺會話管理 |
| SHOT_STATS | 10 | 無實現 | 逐 prompt 統計 |
| EXTRACT_MEMORIES | 7 | 無實現 | 自動記憶提取 |
| TEMPLATES | 6 | Stub | 專案/提示模板 |
| LODESTONE | 6 | N/A | 內部基礎設施 |
| STREAMLINED_OUTPUT | 1 | — | 精簡輸出模式 |
| HOOK_PROMPTS | 1 | — | Hook 提示詞 |
| CCR_AUTO_CONNECT | 3 | — | CCR 自動連接 |
| CCR_MIRROR | 4 | — | CCR 鏡像模式 |
| CCR_REMOTE_SETUP | 1 | — | CCR 遠程設置 |
| NATIVE_CLIPBOARD_IMAGE | 2 | — | 原生剪貼板圖片 |
| CONNECTOR_TEXT | 7 | — | 連接器文本 |

以及其餘 40+ 個低引用量 feature。

---

## 五、探索路線圖

### Phase 1：快速驗證（無外部依賴）

> 目標：確認程式碼可以正常執行，體驗基本功能

| 優先級 | Feature | 命令 | 預期效果 |
|--------|---------|------|----------|
| 1 | BUDDY | `FEATURE_BUDDY=1 bun run dev` | `/buddy hatch` 生成夥伴 |
| 2 | FORK_SUBAGENT | `FEATURE_FORK_SUBAGENT=1 bun run dev` | Agent 可生成上下文繼承的子任務 |
| 3 | TOKEN_BUDGET | `FEATURE_TOKEN_BUDGET=1 bun run dev` | 輸入 "spend 500k tokens" 測試自動持續 |
| 4 | TREE_SITTER_BASH | `FEATURE_TREE_SITTER_BASH=1 bun run dev` | 更精確的 bash 權限匹配 |
| 5 | MCP_SKILLS | `FEATURE_MCP_SKILLS=1 bun run dev` | MCP 服務器 prompt 提升爲技能 |

### Phase 2：核心功能探索（需要 OAuth）

> 目標：體驗 KAIROS 全套能力

| 優先級 | Feature | 命令 | 預期效果 |
|--------|---------|------|----------|
| 1 | TRANSCRIPT_CLASSIFIER | `FEATURE_TRANSCRIPT_CLASSIFIER=1 bun run dev` | Auto mode 自動激活 |
| 2 | KAIROS 全套 | `FEATURE_KAIROS=1 FEATURE_KAIROS_BRIEF=1 FEATURE_KAIROS_CHANNELS=1 FEATURE_PROACTIVE=1 bun run dev` | 常駐助手 + Brief 輸出 + 頻道訊息 |
| 3 | VOICE_MODE | `FEATURE_VOICE_MODE=1 bun run dev` | 按空格說話 |
| 4 | TEAMMEM | `FEATURE_TEAMMEM=1 bun run dev` | 團隊記憶同步 |
| 5 | COORDINATOR_MODE | `FEATURE_COORDINATOR_MODE=1 CLAUDE_CODE_COORDINATOR_MODE=1 bun run dev` | 多 agent 編排 |

### Phase 3：Stub 補全開發

> 目標：將高價值 stub 實現爲可用功能

| 優先級 | Feature | 補全難度 | 價值 |
|--------|---------|----------|------|
| 1 | PROACTIVE | 中 | 自主工作能力 |
| 2 | ULTRAPLAN | 小 | 增強規劃 |
| 3 | CONTEXT_COLLAPSE | 中 | 長對話優化 |
| 4 | EXPERIMENTAL_SKILL_SEARCH | 中 | 技能發現 |
| 5 | BASH_CLASSIFIER | 大 | 安全增強 |

---

## 六、推薦組合方案

### "全功能助手"組合

```bash
FEATURE_KAIROS=1 \
FEATURE_KAIROS_BRIEF=1 \
FEATURE_KAIROS_CHANNELS=1 \
FEATURE_KAIROS_PUSH_NOTIFICATION=1 \
FEATURE_PROACTIVE=1 \
FEATURE_FORK_SUBAGENT=1 \
FEATURE_TOKEN_BUDGET=1 \
FEATURE_TRANSCRIPT_CLASSIFIER=1 \
FEATURE_BUDDY=1 \
bun run dev
```

### "多 Agent 協作"組合

```bash
FEATURE_COORDINATOR_MODE=1 \
FEATURE_FORK_SUBAGENT=1 \
FEATURE_BRIDGE_MODE=1 \
FEATURE_BG_SESSIONS=1 \
CLAUDE_CODE_COORDINATOR_MODE=1 \
bun run dev
```

### "開發者增強"組合

```bash
FEATURE_TRANSCRIPT_CLASSIFIER=1 \
FEATURE_TREE_SITTER_BASH=1 \
FEATURE_TOKEN_BUDGET=1 \
FEATURE_MCP_SKILLS=1 \
FEATURE_CONTEXT_COLLAPSE=1 \
bun run dev
```

---

## 七、風險與注意事項

1. **OAuth 依賴**：KAIROS、VOICE_MODE、TEAMMEM、BRIDGE_MODE 需要 Anthropic OAuth 認證（claude.ai 訂閱），API key 用戶無法使用
2. **GrowthBook 門控**：部分功能（VOICE_MODE 的 `tengu_cobalt_frost`、TEAMMEM 的 `tengu_herring_clock`）即使 feature flag 開啓，還需要服務端 GrowthBook 開關
3. **反編譯不完整**：所有"已實現"功能均爲反編譯產物，可能存在執行時錯誤，需要逐個驗證
4. **Proactive stub**：KAIROS 的自主工作能力依賴 PROACTIVE，但 PROACTIVE 核心是 stub，需先補全
5. **tsc 錯誤**：程式碼庫有 ~1341 個 TypeScript 編譯錯誤（來自反編譯），不影響 Bun 執行時但在 IDE 中會有大量紅線

---

## 附錄：Feature Flag 完整列表

共 89 個 feature flag（按引用數降序）：

| Feature | 引用 | Tier |
|---------|------|------|
| KAIROS | 154 | 1 |
| TRANSCRIPT_CLASSIFIER | 108 | 1 |
| TEAMMEM | 51 | 1 |
| VOICE_MODE | 46 | 1 |
| BASH_CLASSIFIER | 45 | 2 |
| KAIROS_BRIEF | 39 | 1 |
| PROACTIVE | 37 | 2 |
| COORDINATOR_MODE | 32 | 1 |
| BRIDGE_MODE | 28 | 1 |
| EXPERIMENTAL_SKILL_SEARCH | 21 | 2 |
| CONTEXT_COLLAPSE | 20 | 2 |
| KAIROS_CHANNELS | 19 | 1 |
| UDS_INBOX | 17 | 3 |
| CHICAGO_MCP | 16 | 3 |
| BUDDY | 16 | 1 |
| HISTORY_SNIP | 15 | 2 |
| MONITOR_TOOL | 13 | 3 |
| COMMIT_ATTRIBUTION | 12 | — |
| CACHED_MICROCOMPACT | 12 | — |
| BG_SESSIONS | 11 | 3 |
| WORKFLOW_SCRIPTS | 10 | 2 |
| ULTRAPLAN | 10 | 2 |
| SHOT_STATS | 10 | 3 |
| TOKEN_BUDGET | 9 | 1 |
| PROMPT_CACHE_BREAK_DETECTION | 9 | — |
| MCP_SKILLS | 9 | 1 |
| EXTRACT_MEMORIES | 7 | 3 |
| CONNECTOR_TEXT | 7 | — |
| TEMPLATES | 6 | 3 |
| LODESTONE | 6 | 3 |
| TREE_SITTER_BASH_SHADOW | 5 | — |
| QUICK_SEARCH | 5 | — |
| MESSAGE_ACTIONS | 5 | — |
| DOWNLOAD_USER_SETTINGS | 5 | — |
| DIRECT_CONNECT | 5 | — |
| WEB_BROWSER_TOOL | 4 | 2 |
| VERIFICATION_AGENT | 4 | — |
| TERMINAL_PANEL | 4 | — |
| SSH_REMOTE | 4 | — |
| REVIEW_ARTIFACT | 4 | — |
| REACTIVE_COMPACT | 4 | — |
| KAIROS_PUSH_NOTIFICATION | 4 | 1 |
| HISTORY_PICKER | 4 | — |
| FORK_SUBAGENT | 4 | 1 |
| CCR_MIRROR | 4 | — |
| TREE_SITTER_BASH | 3 | 1 |
| MEMORY_SHAPE_TELEMETRY | 3 | — |
| MCP_RICH_OUTPUT | 3 | — |
| KAIROS_GITHUB_WEBHOOKS | 3 | 1 |
| FILE_PERSISTENCE | 3 | — |
| DAEMON | 3 | 2 |
| CCR_AUTO_CONNECT | 3 | — |
| UPLOAD_USER_SETTINGS | 2 | — |
| POWERSHELL_AUTO_MODE | 2 | — |
| OVERFLOW_TEST_TOOL | 2 | — |
| NEW_INIT | 2 | — |
| NATIVE_CLIPBOARD_IMAGE | 2 | — |
| HARD_FAIL | 2 | — |
| ENHANCED_TELEMETRY_BETA | 2 | — |
| COWORKER_TYPE_TELEMETRY | 2 | — |
| BREAK_CACHE_COMMAND | 2 | — |
| AWAY_SUMMARY | 2 | — |
| AUTO_THEME | 2 | — |
| ALLOW_TEST_VERSIONS | 2 | — |
| AGENT_TRIGGERS_REMOTE | 2 | — |
| AGENT_MEMORY_SNAPSHOT | 2 | — |
| UNATTENDED_RETRY | 1 | — |
| ULTRATHINK | 1 | — |
| TORCH | 1 | — |
| STREAMLINED_OUTPUT | 1 | — |
| SLOW_OPERATION_LOGGING | 1 | — |
| SKILL_IMPROVEMENT | 1 | — |
| SELF_HOSTED_RUNNER | 1 | — |
| RUN_SKILL_GENERATOR | 1 | — |
| PERFETTO_TRACING | 1 | — |
| NATIVE_CLIENT_ATTESTATION | 1 | — |
| KAIROS_DREAM | 1 | 1 |
| IS_LIBC_MUSL | 1 | — |
| IS_LIBC_GLIBC | 1 | — |
| HOOK_PROMPTS | 1 | — |
| DUMP_SYSTEM_PROMPT | 1 | — |
| COMPACTION_REMINDERS | 1 | — |
| CCR_REMOTE_SETUP | 1 | — |
| BYOC_ENVIRONMENT_RUNNER | 1 | — |
| BUILTIN_EXPLORE_PLAN_AGENTS | 1 | — |
| BUILDING_CLAUDE_APPS | 1 | — |
| ANTI_DISTILLATION_CC | 1 | — |
| AGENT_TRIGGERS | 1 | — |
| ABLATION_BASELINE | 1 | — |
