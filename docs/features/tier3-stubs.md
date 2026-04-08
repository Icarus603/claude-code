# Tier 3 — 純 Stub / N/A 低優先級 Feature 概覽

> 本文件彙總所有 Tier 3 feature。這些功能要麼是純 Stub（所有函數返回空值），
> 要麼是 Anthropic 內部基礎設施（N/A），要麼是引用量極低的輔助功能。

## 概覽

| Feature | 引用 | 狀態 | 類別 | 簡要說明 |
|---------|------|------|------|---------|
| CHICAGO_MCP | 16 | N/A | 內部基礎設施 | Anthropic 內部 MCP 基礎設施，非外部可用 |
| UDS_INBOX | 17 | Stub | 訊息通信 | Unix 域套接字對等訊息，進程間訊息傳遞 |
| MONITOR_TOOL | 13 | Stub | 工具 | 文件/進程監控工具，檢測變更並通知 |
| BG_SESSIONS | 11 | Stub | 會話管理 | 後臺會話管理，支援多會話並行 |
| SHOT_STATS | 10 | 無實現 | 統計 | 逐 prompt 統計信息收集 |
| EXTRACT_MEMORIES | 7 | 無實現 | 記憶 | 自動從對話中提取重要信息作爲記憶 |
| TEMPLATES | 6 | Stub | 專案管理 | 專案/提示模板系統 |
| LODESTONE | 6 | N/A | 內部基礎設施 | 內部基礎設施模組 |
| STREAMLINED_OUTPUT | 1 | — | 輸出 | 精簡輸出模式，減少終端輸出量 |
| HOOK_PROMPTS | 1 | — | 鉤子 | Hook 提示詞，自定義鉤子的提示注入 |
| CCR_AUTO_CONNECT | 3 | — | 遠程控制 | CCR 自動連接，自動建立遠程控制會話 |
| CCR_MIRROR | 4 | — | 遠程控制 | CCR 鏡像模式，會話狀態同步 |
| CCR_REMOTE_SETUP | 1 | — | 遠程控制 | CCR 遠程設置，初始化遠程控制設定 |
| NATIVE_CLIPBOARD_IMAGE | 2 | — | 系統集成 | 原生剪貼板圖片，從剪貼板讀取圖片 |
| CONNECTOR_TEXT | 7 | — | 連接器 | 連接器文本，外部系統文本適配 |
| COMMIT_ATTRIBUTION | 12 | — | Git | Commit 歸因，標記 commit 來源 |
| CACHED_MICROCOMPACT | 12 | — | 壓縮 | 快取微壓縮，優化 compaction 性能 |
| PROMPT_CACHE_BREAK_DETECTION | 9 | — | 性能 | Prompt cache 中斷檢測，監控 cache miss |
| MEMORY_SHAPE_TELEMETRY | 3 | — | 遙測 | 記憶形態遙測，記憶使用模式追蹤 |
| MCP_RICH_OUTPUT | 3 | — | MCP | MCP 富輸出，增強 MCP 工具輸出格式 |
| FILE_PERSISTENCE | 3 | — | 持久化 | 文件持久化，跨會話保持狀態 |
| TREE_SITTER_BASH_SHADOW | 5 | Shadow | 安全 | Bash AST Shadow 模式（見 tree-sitter-bash.md） |
| QUICK_SEARCH | 5 | — | 搜索 | 快速搜索，優化的文件/內容搜索 |
| MESSAGE_ACTIONS | 5 | — | UI | 訊息操作，對訊息執行後處理動作 |
| DOWNLOAD_USER_SETTINGS | 5 | — | 設定 | 下載用戶設置，從服務端同步設定 |
| DIRECT_CONNECT | 5 | — | 網絡 | 直連模式，繞過代理直接連接 API |
| VERIFICATION_AGENT | 4 | — | Agent | 驗證 Agent，專門用於驗證程式碼變更 |
| TERMINAL_PANEL | 4 | — | UI | 終端面板，嵌入式終端輸出顯示 |
| SSH_REMOTE | 4 | — | 遠程 | SSH 遠程，通過 SSH 連接遠程 Claude |
| REVIEW_ARTIFACT | 4 | — | 審查 | Review Artifact，程式碼審查產出物 |
| REACTIVE_COMPACT | 4 | — | 壓縮 | 響應式壓縮，基於上下文變化觸發 compaction |
| HISTORY_PICKER | 4 | — | UI | 歷史選擇器，瀏覽和選擇歷史對話 |
| UPLOAD_USER_SETTINGS | 2 | — | 設定 | 上傳用戶設置，同步設定到服務端 |
| POWERSHELL_AUTO_MODE | 2 | — | 平臺 | PowerShell 自動模式，Windows 權限自動化 |
| OVERFLOW_TEST_TOOL | 2 | — | 測試 | 溢出測試工具，測試上下文溢出處理 |
| NEW_INIT | 2 | — | 初始化 | 新版初始化流程 |
| HARD_FAIL | 2 | — | 錯誤處理 | 硬失敗模式，不可恢復錯誤直接終止 |
| ENHANCED_TELEMETRY_BETA | 2 | — | 遙測 | 增強遙測 Beta，詳細的性能指標收集 |
| COWORKER_TYPE_TELEMETRY | 2 | — | 遙測 | 協作者類型遙測，追蹤協作模式 |
| BREAK_CACHE_COMMAND | 2 | — | 快取 | 中斷快取命令，強制刷新 prompt cache |
| AWAY_SUMMARY | 2 | — | 摘要 | 離開摘要，用戶返回時總結期間工作 |
| AUTO_THEME | 2 | — | UI | 自動主題，根據終端設置切換主題 |
| ALLOW_TEST_VERSIONS | 2 | — | 版本 | 允許測試版本，跳過版本檢查 |
| AGENT_TRIGGERS_REMOTE | 2 | — | Agent | Agent 遠程觸發，從遠程觸發 Agent 任務 |
| AGENT_MEMORY_SNAPSHOT | 2 | — | Agent | Agent 記憶快照，保存/恢復 Agent 狀態 |

## 單引用 Feature（40+ 個）

以下 feature 各只有 1 處引用，多爲內部標記或實驗性功能：

UNATTENDED_RETRY, ULTRATHINK, TORCH, SLOW_OPERATION_LOGGING, SKILL_IMPROVEMENT,
SELF_HOSTED_RUNNER, RUN_SKILL_GENERATOR, PERFETTO_TRACING, NATIVE_CLIENT_ATTESTATION,
KAIROS_DREAM（見 kairos.md）, IS_LIBC_MUSL, IS_LIBC_GLIBC, DUMP_SYSTEM_PROMPT,
COMPACTION_REMINDERS, CCR_REMOTE_SETUP, BYOC_ENVIRONMENT_RUNNER, BUILTIN_EXPLORE_PLAN_AGENTS,
BUILDING_CLAUDE_APPS, ANTI_DISTILLATION_CC, AGENT_TRIGGERS, ABLATION_BASELINE

## 優先級說明

這些 feature 被列爲 Tier 3 的原因：

1. **內部基礎設施**（CHICAGO_MCP, LODESTONE）：Anthropic 內部使用，外部無法執行
2. **純 Stub 且引用低**（UDS_INBOX, MONITOR_TOOL, BG_SESSIONS）：需要大量工作才能實現
3. **實驗性功能**（SHOT_STATS, EXTRACT_MEMORIES）：尚在概念階段
4. **輔助功能**（STREAMLINED_OUTPUT, HOOK_PROMPTS）：影響範圍小
5. **CCR 系列**：依賴遠程控制基礎設施，需要 BRIDGE_MODE 先完善

如需深入瞭解某個 Tier 3 feature，可以在程式碼庫中搜索 `feature('FEATURE_NAME')` 查看具體使用場景。
