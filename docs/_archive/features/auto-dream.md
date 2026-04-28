# Auto Dream — 自動記憶整理

## 概述

Auto Dream 是 Claude Code 的後臺記憶整合機制。它在會話間自動審查、組織和修剪持久化記憶文件，確保未來會話能快速獲得準確的上下文。

記憶系統存儲在檔案系統中（預設 `~/.claude/projects/<project-slug>/memory/`），由 `MEMORY.md` 索引文件和若干主題文件（如 `user_language.md`、`project_overview.md`）組成。隨着會話積累，記憶會變得過時、冗餘或矛盾——Dream 負責清理這些堆積。

## 架構

### 核心模組

| 模組 | 路徑 | 職責 |
|------|------|------|
| 調度器 | `src/services/autoDream/autoDream.ts` | 時間/會話/鎖三重門控，觸發 forked agent |
| 設定 | `src/services/autoDream/config.ts` | 讀取 `isAutoDreamEnabled()` 開關 |
| 提示詞 | `src/services/autoDream/consolidationPrompt.ts` | 構建 4 階段整理提示詞 |
| 鎖文件 | `src/services/autoDream/consolidationLock.ts` | PID 鎖 + mtime 作爲 `lastConsolidatedAt` |
| 任務 UI | `src/tasks/DreamTask/DreamTask.ts` | 後臺任務註冊，footer pill + Shift+Down 可見 |
| 手動入口 | `src/skills/bundled/dream.ts` | `/dream` 命令，無條件可用 |

### 記憶路徑解析

優先級（`src/memdir/paths.ts`）：

1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` 環境變量（完整路徑覆蓋）
2. `autoMemoryDirectory` 設置項（`settings.json`，支援 `~/` 展開）
3. 預設：`<memoryBase>/projects/<sanitized-git-root>/memory/`

其中 `memoryBase` = `CLAUDE_CODE_REMOTE_MEMORY_DIR` 或 `~/.claude`。

## 觸發機制

### 自動觸發（Auto Dream）

每個對話輪次結束後，`executeAutoDream()` 按順序檢查三重門控：

```
┌─────────────────────────────────────────────────────┐
│  Gate 1: 全局開關                                     │
│  isAutoMemoryEnabled() && isAutoDreamEnabled()       │
│  排除: KAIROS 模式 / Remote 模式                      │
├─────────────────────────────────────────────────────┤
│  Gate 2: 時間門控                                     │
│  hoursSince(lastConsolidatedAt) >= minHours          │
│  預設: 24 小時                                        │
├─────────────────────────────────────────────────────┤
│  Gate 3: 會話門控                                     │
│  sessionsTouchedSince(lastConsolidatedAt) >= minSessions │
│  預設: 5 個會話（排除當前會話）                         │
├─────────────────────────────────────────────────────┤
│  Lock: PID 鎖文件                                     │
│  .consolidate-lock (mtime = lastConsolidatedAt)      │
│  死進程檢測 + 1 小時過期                               │
└─────────────────────────────────────────────────────┘
```

全部通過後，以 **forked agent**（受限子代理）方式執行整理任務：

- Bash 工具限制爲只讀命令（`ls`、`grep`、`cat` 等）
- 只能讀寫記憶目錄內的文件
- 用戶可在 Shift+Down 後臺任務面板中查看進度或終止

### 手動觸發（`/dream` 命令）

通過 `/dream` 命令隨時觸發，無門控限制：

- 在主循環中執行（非 forked agent），擁有完整工具權限
- 用戶可實時觀察操作過程
- 執行前自動更新鎖文件 mtime

### 設定開關

| 開關 | 位置 | 作用 |
|------|------|------|
| `autoDreamEnabled` | `settings.json` | `true`/`false` 顯式開關 |
| `autoMemoryEnabled` | `settings.json` | 總開關，關閉後所有記憶功能禁用 |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | 環境變量 | `1`/`true` 關閉所有記憶功能 |
| `tengu_onyx_plover` | GrowthBook | 官方遠程設定，控制 `enabled`/`minHours`/`minSessions` |

預設值（無 GrowthBook 連接時）：

```typescript
minHours: 24      // 距上次整理至少 24 小時
minSessions: 5    // 至少有 5 個新會話
```

## 整理流程（4 階段）

Dream agent 執行的提示詞包含 4 個階段：

### Phase 1 — 定位（Orient）

- `ls` 記憶目錄，查看現有文件
- 讀取 `MEMORY.md` 索引
- 瀏覽現有主題文件，避免重複建立

### Phase 2 — 採集信號（Gather）

按優先級收集新信息：

1. **日誌文件**（`logs/YYYY/MM/YYYY-MM-DD.md`，KAIROS 模式下的追加式日誌）
2. **過時記憶** — 與當前程式碼庫狀態矛盾的事實
3. **會話記錄** — 窄關鍵詞 grep JSONL 文件（不全文讀取）

### Phase 3 — 整合（Consolidate）

- 合併新信號到現有主題文件，而非建立近似重複
- 將相對日期（"昨天"、"上週"）轉爲絕對日期
- 刪除被推翻的事實

### Phase 4 — 修剪與索引（Prune）

- `MEMORY.md` 保持在 200 行以內、25KB 以內
- 每條索引項一行，不超過 150 字符
- 移除過時/錯誤/被取代的指針

## 記憶類型

記憶系統使用 4 種類型（`src/memdir/memoryTypes.ts`）：

| 類型 | 用途 | 示例 |
|------|------|------|
| `user` | 用戶角色、偏好、知識 | 用戶是高級後端工程師，偏好中文交流 |
| `feedback` | 工作方式指導 | 不要 mock 資料庫測試；程式碼審查用 bundled PR |
| `project` | 專案上下文（非程式碼可推導的） | 合併凍結從 3 月 5 日開始；認證重寫是合規需求 |
| `reference` | 外部系統指針 | Linear INGEST 專案跟蹤 pipeline bugs |

**不保存的內容**：程式碼模式、架構、檔案路徑（可從程式碼推導）；Git 歷史（`git log` 權威）；調試方案（程式碼中已有）。

## 鎖文件機制

`.consolidate-lock` 文件位於記憶目錄內：

- **檔案內容**：持有者 PID
- **mtime**：即 `lastConsolidatedAt` 時間戳
- **過期**：1 小時（防 PID 複用）
- **競態處理**：雙進程同時寫入時，後讀驗證 PID，失敗者退出
- **回滾**：forked agent 失敗或被用戶終止時，mtime 回退到取得前的值

## 使用場景

### 場景 1：日常開發中的自動整理

開發者連續多天使用 Claude Code 處理不同任務。Auto Dream 在積累 5+ 個會話且距上次整理 24 小時後自動觸發，整合分散在多次會話中的用戶偏好和專案決策。

### 場景 2：手動整理記憶

用戶發現 Claude 重複犯相同錯誤或遺忘之前的決策。輸入 `/dream` 立即觸發整理，無需等待自動觸發週期。

### 場景 3：新會話快速上下文

新會話啓動時，`MEMORY.md` 被加載到上下文中。經過 Dream 整理的記憶文件結構清晰、信息準確，讓 Claude 快速瞭解用戶和專案。

### 場景 4：KAIROS 模式下的日誌蒸餾

KAIROS（長駐助手模式）中，agent 以追加方式寫入日期日誌文件。Dream 負責將這些日誌蒸餾爲主題文件和 `MEMORY.md` 索引。

## 與其他系統的關係

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│ 會話交互     │────▶│ 記憶寫入      │────▶│ MEMORY.md     │
│ (主 agent)  │     │ (即時保存)    │     │ + 主題文件     │
└─────────────┘     └──────────────┘     └───────┬───────┘
                                               │
       ┌───────────────────────────────────────┘
       ▼
┌──────────────┐     ┌──────────────┐
│ Auto Dream   │────▶│ 整理/修剪    │
│ (後臺觸發)   │     │ 去重/糾錯    │
└──────────────┘     └──────────────┘
       ▲
┌──────────────┐
│ /dream 命令  │
│ (手動觸發)   │
└──────────────┘
```

- **extractMemories**（`src/services/extractMemories/`）：每輪次結束時從對話中提取新記憶並寫入。Dream 不負責提取，只負責整理。
- **CLAUDE.md**：專案級指令文件，加載到上下文中但不屬於記憶系統。
- **Team Memory**（`TEAMMEM` feature）：團隊共享記憶目錄，與個人記憶使用相同的 Dream 機制。
