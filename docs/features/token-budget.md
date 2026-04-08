# TOKEN_BUDGET — Token 預算自動持續模式

> Feature Flag: `FEATURE_TOKEN_BUDGET=1`
> 實現狀態：完整可用

## 一、功能概述

TOKEN_BUDGET 讓用戶在 prompt 中指定一個 output token 預算目標（如 `+500k`、`spend 2M tokens`），Claude 會**自動持續工作**直到達到目標，無需用戶反覆按回車催促繼續。

適用於大型重構、批量修改、大規模程式碼生成等需要多輪工具呼叫的長任務。

## 二、用戶交互

### 語法

| 格式 | 示例 | 說明 |
|------|------|------|
| 簡寫（開頭） | `+500k` | 輸入開頭直接寫 |
| 簡寫（結尾） | `幫我重構這個模組 +2m` | 輸入末尾追加 |
| 完整語法 | `spend 2M tokens` 或 `use 1B tokens` | 自然語言嵌入 |

單位支援：`k`（千）、`m`（百萬）、`b`（十億），大小寫不敏感。

### UI 反饋

- **輸入框高亮**：輸入包含預算語法時，對應文字會被高亮標記（`PromptInput.tsx` 通過 `findTokenBudgetPositions` 計算）
- **Spinner 進度**：底部 spinner 顯示實時進度，格式如：
  - 未完成：`Target: 125,000 / 500,000 (25%) · ~2m 30s`
  - 已完成：`Target: 510,000 used (500,000 min ✓)`
  - 包含 ETA（基於當前 token 產出速率計算）

## 三、實現架構

### 資料流

```
用戶輸入 "+500k"
     │
     ▼
┌─────────────────────────┐
│  parseTokenBudget()     │  src/utils/tokenBudget.ts
│  正則解析 → 500,000     │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  REPL.tsx               │  提交時呼叫
│  snapshotOutputTokens   │  snapshotOutputTokensForTurn(500000)
│  ForTurn(500000)        │  記錄 turn 起始 token 數 + 預算
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  query.ts 主循環        │  每輪結束後檢查
│  checkTokenBudget()     │  當前 output tokens vs 預算
└────────┬────────────────┘
         │
    ┌────┴─────┐
    │          │
    ▼          ▼
 continue    stop
 (未達 90%)   (已達 90% 或收益遞減)
    │          │
    ▼          ▼
 注入 nudge   正常結束
 訊息繼續     發送完成事件
```

### 核心模組

#### 1. 解析層 — `src/utils/tokenBudget.ts`

三個正則表達式解析用戶輸入：

```
SHORTHAND_START_RE = /^\s*\+(\d+(?:\.\d+)?)\s*(k|m|b)\b/i   // "+500k" 在開頭
SHORTHAND_END_RE   = /\s\+(\d+(?:\.\d+)?)\s*(k|m|b)\s*[.!?]?\s*$/i  // "+2m" 在結尾
VERBOSE_RE         = /\b(?:use|spend)\s+(\d+(?:\.\d+)?)\s*(k|m|b)\s*tokens?\b/i  // "spend 2M tokens"
```

- `parseTokenBudget(text)` — 提取預算數值，返回 `number | null`
- `findTokenBudgetPositions(text)` — 返回匹配位置數組，用於輸入框高亮
- `getBudgetContinuationMessage(pct, turnTokens, budget)` — 生成繼續訊息

#### 2. 狀態層 — `src/bootstrap/state.ts`

模組級單例變量追蹤當前 turn 的預算狀態：

```
outputTokensAtTurnStart   — 本 turn 開始時的累計 output token 數
currentTurnTokenBudget    — 本 turn 的預算目標（null 表示無預算）
budgetContinuationCount   — 本 turn 已自動續接的次數
```

關鍵函數：
- `getTotalOutputTokens()` — 從 `STATE.modelUsage` 彙總所有模型的 output tokens
- `getTurnOutputTokens()` — `getTotalOutputTokens() - outputTokensAtTurnStart`
- `snapshotOutputTokensForTurn(budget)` — 重置 turn 起點，設置新預算
- `getCurrentTurnTokenBudget()` — 返回當前預算

#### 3. 決策層 — `src/query/tokenBudget.ts`

`checkTokenBudget(tracker, agentId, budget, globalTurnTokens)` 做出 continue/stop 決策：

**繼續條件**：
- 不在子 agent 中（`agentId` 爲空）
- 預算存在且 > 0
- 當前 token 未達預算的 **90%**
- 非收益遞減（連續 3 輪 nudge 後，每輪新增 < 500 tokens）

**停止條件**：
- 達到預算 90%
- 收益遞減（模型已經"做不動了"）
- 子 agent 模式下直接跳過

**收益遞減檢測**：`continuationCount >= 3` 且最近兩次 nudge 的 delta 都 < 500 tokens。

#### 4. 主循環集成 — `src/query.ts`

```
query() 函數內：
  1. 建立 budgetTracker = createBudgetTracker()
  2. 進入 while 循環
  3. 每輪結束後呼叫 checkTokenBudget()
  4. decision.action === 'continue' 時：
     - 注入 meta user message（nudge）
     - continue 回到循環頂部
  5. decision.action === 'stop' 時：
     - 記錄完成事件（含 diminishingReturns 標記）
     - 正常返回
```

#### 5. UI 層

| 文件 | 職責 |
|------|------|
| `components/PromptInput/PromptInput.tsx:534` | 輸入框中高亮預算語法 |
| `components/Spinner.tsx:319-338` | spinner 顯示進度百分比 + ETA |
| `screens/REPL.tsx:2897` | 提交時解析預算並快照 |
| `screens/REPL.tsx:2138` | 用戶取消時清除預算 |
| `screens/REPL.tsx:2963` | turn 結束時捕獲預算信息用於顯示 |

#### 6. 系統提示 — `src/constants/prompts.ts:538-551`

注入 `token_budget` section：

> "When the user specifies a token target (e.g., '+500k', 'spend 2M tokens', 'use 1B tokens'), your output token count will be shown each turn. Keep working until you approach the target — plan your work to fill it productively. The target is a hard minimum, not a suggestion. If you stop early, the system will automatically continue you."

注意：這段 prompt **無條件快取**（不隨預算開關變化），因爲 "When the user specifies..." 的措辭在沒有預算時是空操作。

#### 7. API 附件 — `src/utils/attachments.ts:3830-3845`

每輪 API 呼叫附帶 `output_token_usage` attachment：

```json
{
  "type": "output_token_usage",
  "turn": 125000,     // 本 turn 產出
  "session": 350000,  // 會話總產出
  "budget": 500000    // 預算目標
}
```

讓模型能看到自己的進度。

## 四、關鍵設計決策

1. **90% 閾值而非 100%**：在 `COMPLETION_THRESHOLD = 0.9` 處停止，避免最後一輪 nudge 產生遠超預算的 token
2. **收益遞減保護**：連續 3 輪 nudge 後如果每輪產出 < 500 tokens，判定模型已無實質進展，提前終止
3. **子 agent 豁免**：AgentTool 內部的子任務不做預算檢查，避免子任務重複觸發續接
4. **無條件快取系統提示**：預算 prompt 始終注入（不隨預算變化 toggle），避免每次切換預算導致 ~20K token 的 cache miss
5. **用戶取消清預算**：按 Escape 取消時呼叫 `snapshotOutputTokensForTurn(null)`，防止殘留預算觸發續接

## 五、使用方式

```bash
# 啓用 feature
FEATURE_TOKEN_BUDGET=1 bun run dev

# 在 prompt 中使用
> +500k 重構所有測試文件
> spend 2M tokens 把這個專案從 JS 遷移到 TS
> 幫我寫完整的 CRUD 模組 +1m
```

## 六、檔案索引

| 文件 | 行數 | 職責 |
|------|------|------|
| `src/utils/tokenBudget.ts` | 73 | 正則解析 + 位置查找 + 續接訊息生成 |
| `src/query/tokenBudget.ts` | 93 | 預算追蹤器 + continue/stop 決策 |
| `src/bootstrap/state.ts:724-743` | 20 | turn 級 token 快照狀態 |
| `src/constants/prompts.ts:538-551` | 14 | 系統提示注入 |
| `src/utils/attachments.ts:3829-3845` | 17 | API attachment 附加 |
| `src/query.ts:280,1311-1358` | 48 | 主循環集成 |
| `src/screens/REPL.tsx:2897,2963,2138` | 20 | REPL 提交/完成/取消處理 |
| `src/components/Spinner.tsx:319-338` | 20 | 進度條 UI |
| `src/components/PromptInput/PromptInput.tsx:534` | 1 | 輸入高亮 |
