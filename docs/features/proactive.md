# PROACTIVE — 主動模式

> Feature Flag: `FEATURE_PROACTIVE=1`（與 `FEATURE_KAIROS=1` 共享功能）
> 實現狀態：核心模組全部 Stub，佈線完整
> 引用數：37

## 一、功能概述

PROACTIVE 實現 Tick 驅動的自主代理。CLI 在用戶不輸入時也能持續工作：定時喚醒執行任務，配合 SleepTool 控制節奏。適用於長時間執行的後臺任務（等待 CI、監控文件變化、定時檢查等）。

### 與 KAIROS 的關係

所有程式碼檢查都是 `feature('PROACTIVE') || feature('KAIROS')`，即：
- 單獨開 `FEATURE_PROACTIVE=1` → 獲得 proactive 能力
- 單獨開 `FEATURE_KAIROS=1` → 自動獲得 proactive 能力
- 兩者都開 → 相同效果（不重複）

## 二、實現架構

### 2.1 模組狀態

| 模組 | 文件 | 狀態 | 說明 |
|------|------|------|------|
| 核心邏輯 | `src/proactive/index.ts` | **Stub** | `activateProactive()`、`deactivateProactive()`、`isProactiveActive() => false` |
| SleepTool 提示 | `src/tools/SleepTool/prompt.ts` | **完整** | 工具提示定義（工具名：`Sleep`） |
| 命令註冊 | `src/commands.ts:62-65` | **佈線** | 動態加載 `./commands/proactive.js` |
| 工具註冊 | `src/tools.ts:26-28` | **佈線** | SleepTool 動態加載 |
| REPL 集成 | `src/screens/REPL.tsx` | **佈線** | tick 驅動邏輯、佔位符、頁腳 UI |
| 系統提示 | `src/constants/prompts.ts:860-914` | **完整** | 自主工作行爲指令（~55 行詳細 prompt） |
| 會話存儲 | `src/utils/sessionStorage.ts:4892-4912` | **佈線** | tick 訊息注入對話流 |

### 2.2 系統提示內容

`getProactiveSection()` 注入的自主工作指令包含：

| 章節 | 內容 |
|------|------|
| Tick 驅動 | `<tick_tag>` prompt 保持存活，包含用戶本地時間 |
| 節奏控制 | SleepTool 控制等待間隔，prompt cache 5 分鐘過期 |
| 空操作規則 | 無事可做時**必須**呼叫 Sleep，禁止輸出 "still waiting" |
| 首次喚醒 | 簡短問候，等待方向（不主動探索） |
| 後續喚醒 | 尋找有用工作：調查、驗證、檢查（不 spam 用戶） |
| 偏向行動 | 讀文件、搜索程式碼、commit — 不需詢問 |
| 終端焦點 | `terminalFocus` 字段調節自主程度 |

### 2.3 資料流

```
activateProactive() [需要實現]
      │
      ▼
Tick 調度器啓動
      │
      ├── 定時生成 <tick_tag> 訊息
      │   ├── 包含用戶當前本地時間
      │   └── 注入到對話流（sessionStorage）
      │
      ▼
模型處理 tick
      │
      ├── 有事可做 → 使用工具執行 → 可能再次 Sleep
      └── 無事可做 → 必須呼叫 SleepTool
      │
      ▼
SleepTool 等待 [需要實現]
      │
      ▼
下一個 tick 到達
```

## 三、需要補全的內容

| 優先級 | 模組 | 工作量 | 說明 |
|--------|------|--------|------|
| 1 | `src/proactive/index.ts` | 中 | Tick 調度器、activate/deactivate 狀態機、pause/resume |
| 2 | `src/tools/SleepTool/SleepTool.ts` | 小 | 工具執行（等待指定時間後觸發 tick） |
| 3 | `src/commands/proactive.js` | 小 | `/proactive` 斜槓命令處理器 |
| 4 | `src/hooks/useProactive.ts` | 中 | React hook（REPL 引用但不存在） |

## 四、關鍵設計決策

1. **Tick 驅動**：模型通過 SleepTool 自行控制喚醒頻率，不是外部事件推送
2. **空操作必須 Sleep**：防止 "still waiting" 類空訊息浪費 turn 和 token
3. **Prompt cache 考量**：SleepTool 提示中提到 cache 5 分鐘過期，建議平衡等待時間
4. **Terminal Focus 感知**：模型根據用戶是否在看終端調整自主程度

## 五、使用方式

```bash
# 單獨啓用 proactive
FEATURE_PROACTIVE=1 bun run dev

# 通過 KAIROS 間接啓用
FEATURE_KAIROS=1 bun run dev

# 組合使用
FEATURE_PROACTIVE=1 FEATURE_KAIROS=1 FEATURE_KAIROS_BRIEF=1 bun run dev
```

## 六、檔案索引

| 文件 | 職責 |
|------|------|
| `src/proactive/index.ts` | 核心邏輯（stub） |
| `src/tools/SleepTool/prompt.ts` | SleepTool 工具提示 |
| `src/constants/prompts.ts:860-914` | 自主工作系統提示 |
| `src/screens/REPL.tsx` | REPL tick 集成 |
| `src/utils/sessionStorage.ts:4892-4912` | Tick 訊息注入 |
| `src/components/PromptInput/PromptInputFooterLeftSide.tsx` | 頁腳 UI 狀態 |
