# ULTRAPLAN — 增強規劃

> Feature Flag: `FEATURE_ULTRAPLAN=1`
> 實現狀態：關鍵字檢測完整，命令處理完整，CCR 遠程會話完整
> 引用數：10

## 一、功能概述

ULTRAPLAN 在用戶輸入中檢測 "ultraplan" 關鍵字時，自動進入增強計劃模式。相比普通 plan mode，ultraplan 提供更深入的規劃能力，支援本地和遠程（CCR）執行。

### 觸發方式

| 方式 | 行爲 |
|------|------|
| 輸入含 "ultraplan" 的文本 | 自動重定向到 `/ultraplan` 命令 |
| `/ultraplan` 斜槓命令 | 直接執行 |
| 彩虹高亮 | 輸入框中 "ultraplan" 關鍵字彩虹動畫 |

## 二、實現架構

### 2.1 模組狀態

| 模組 | 文件 | 行數 | 狀態 |
|------|------|------|------|
| 命令處理器 | `src/commands/ultraplan.tsx` | 472 | **完整** |
| CCR 會話 | `src/utils/ultraplan/ccrSession.ts` | 350 | **完整** |
| 關鍵字檢測 | `src/utils/ultraplan/keyword.ts` | 128 | **完整** |
| 嵌入式提示 | `src/utils/ultraplan/prompt.txt` | 1 | **完整** |
| REPL 對話框 | `src/screens/REPL.tsx` | — | **佈線** |
| 關鍵字高亮 | `src/components/PromptInput/PromptInput.tsx` | — | **佈線** |

### 2.2 關鍵字檢測

文件：`src/utils/ultraplan/keyword.ts`（128 行）

`findUltraplanTriggerPositions(text)` 智能過濾：
- 排除引號內的 "ultraplan"
- 排除路徑中的 "ultraplan"（如 `/path/to/ultraplan/`）
- 排除斜槓命令以外的上下文
- `replaceUltraplanKeyword(text)` 清理關鍵字

### 2.3 CCR 遠程會話

文件：`src/utils/ultraplan/ccrSession.ts`（350 行）

`ExitPlanModeScanner` 類實現完整的事件狀態機：
- `pollForApprovedExitPlanMode()` — 3 秒輪詢間隔
- 超時處理和重試
- 支援遠程（teleport）和本地執行

### 2.4 資料流

```
用戶輸入 "幫我 ultraplan 重構這個模組"
         │
         ▼
processUserInput 檢測 "ultraplan"
         │
         ▼
重定向到 /ultraplan 命令
         │
         ├── 本地執行 → EnterPlanMode
         │
         └── 遠程執行 → teleportToRemote → CCR 會話
                │
                ▼
         ExitPlanModeScanner 輪詢
                │
                ▼
         用戶在遠程審批 → 本地收到結果
```

## 三、需要補全的內容

| 模組 | 說明 |
|------|------|
| `src/screens/REPL.tsx` 中的 UltraplanChoiceDialog / UltraplanLaunchDialog | 用戶選擇本地/遠程執行的對話框組件 |
| `src/commands/ultraplan/` | 空目錄，可能是未合併的子命令結構 |

## 四、關鍵設計決策

1. **智能關鍵字過濾**：排除引號和路徑中的 "ultraplan"，避免誤觸發
2. **本地/遠程雙模式**：支援本地 plan mode 和 CCR 遠程會話
3. **彩虹高亮反饋**：輸入框中 "ultraplan" 關鍵字使用彩虹動畫，暗示這是特殊功能
4. **processUserInput 集成**：在用戶輸入處理管道中攔截，無縫重定向

## 五、使用方式

```bash
# 啓用 feature
FEATURE_ULTRAPLAN=1 bun run dev

# 在 REPL 中使用
# > ultraplan 重構認證模組
# > /ultraplan
```

## 六、檔案索引

| 文件 | 行數 | 職責 |
|------|------|------|
| `src/commands/ultraplan.tsx` | 472 | 斜槓命令處理器 |
| `src/utils/ultraplan/ccrSession.ts` | 350 | CCR 遠程會話管理 |
| `src/utils/ultraplan/keyword.ts` | 128 | 關鍵字檢測和替換 |
| `src/utils/ultraplan/prompt.txt` | 1 | 嵌入式提示 |
| `src/utils/processUserInput/processUserInput.ts:468` | — | 關鍵字重定向 |
| `src/components/PromptInput/PromptInput.tsx` | — | 彩虹高亮 |
