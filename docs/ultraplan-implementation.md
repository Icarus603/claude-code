# ULTRAPLAN（增強規劃）實現分析

> 生成日期：2026-04-02
> Feature Flag：`FEATURE_ULTRAPLAN=1`
> 引用數：10（跨 8 個文件）

---

## 一、功能概述

ULTRAPLAN 是一個**遠程增強規劃**功能，將用戶的規劃請求發送到 Claude Code on the Web（CCR，雲端容器）執行。使用 Opus 模型在雲端生成高級計劃，用戶可以在瀏覽器中編輯和審批，然後選擇在雲端繼續執行或將計劃"傳送"回本地終端執行。

**核心賣點**：
- 終端不被阻塞 — 遠程在雲端規劃，本地可繼續工作
- 使用最強大的模型（Opus）
- 用戶可在瀏覽器中實時查看和編輯計劃
- 支援多輪迭代（雲端可追問，用戶在瀏覽器回覆）

---

## 二、架構總覽

```
用戶輸入 "ultraplan xxx"
        │
        ▼
┌─────────────────────────────────┐
│  關鍵字檢測層 (keyword.ts)       │  識別 "ultraplan" 關鍵字
│  + 輸入處理層 (processUserInput) │  重寫爲 /ultraplan 命令
└───────────┬─────────────────────┘
            │
            ▼
┌─────────────────────────────────┐
│  命令處理層 (ultraplan.tsx)      │  launchUltraplan()
│  - 前置校驗（資格、防重入）      │  → launchDetached()
│  - 構建提示詞                    │  buildUltraplanPrompt()
└───────────┬─────────────────────┘
            │
            ▼
┌─────────────────────────────────┐
│  遠程會話層                      │  teleportToRemote()
│  - 建立 CCR 雲端會話             │  permissionMode: 'plan'
│  - 設置 plan 權限模式            │  model: Opus
└───────────┬─────────────────────┘
            │
            ▼
┌─────────────────────────────────┐
│  輪詢層 (ccrSession.ts)         │  pollForApprovedExitPlanMode()
│  - ExitPlanModeScanner          │  每 3 秒輪詢事件流
│  - 狀態機: running → needs_input │  超時: 30 分鐘
│                → plan_ready      │
└───────────┬─────────────────────┘
            │
      ┌─────┴─────┐
      ▼           ▼
   approved    teleport
  (雲端執行)   (傳送回本地)
      │           │
      │           ▼
      │    UltraplanChoiceDialog
      │    用戶選擇執行方式
      ▼           ▼
   完成通知    本地執行計劃
```

---

## 三、模組詳解

### 3.1 關鍵字檢測 — `src/utils/ultraplan/keyword.ts`

負責檢測用戶輸入中的 "ultraplan" 關鍵字。檢測邏輯相當精細，避免誤觸發：

**觸發條件**：輸入中包含獨立的 `ultraplan` 單詞（大小寫不敏感）。

**不觸發的場景**：
- 在引號/括號內：`` `ultraplan` ``、`"ultraplan"`、`[ultraplan]`、`{ultraplan}`
- 路徑/標識符上下文：`src/ultraplan/foo.ts`、`ultraplan.tsx`、`--ultraplan-mode`
- 問句：`ultraplan?`
- 斜槓命令內：`/rename ultraplan foo`
- 已有 ultraplan 會話執行中或正在啓動時

**關鍵字替換**：觸發後將 `ultraplan` 替換爲 `plan`，保持語法通順（如 "please ultraplan this" → "please plan this"）。

```typescript
// 核心導出函數
findUltraplanTriggerPositions(text)  // 返回觸發位置數組
hasUltraplanKeyword(text)            // 布爾判斷
replaceUltraplanKeyword(text)        // 替換第一個觸發詞爲 "plan"
```

### 3.2 命令註冊 — `src/commands.ts`

```typescript
const ultraplan = feature('ULTRAPLAN')
  ? require('./commands/ultraplan.js').default
  : null
```

命令僅在 `FEATURE_ULTRAPLAN=1` 時加載。命令定義：

```typescript
{
  type: 'local-jsx',
  name: 'ultraplan',
  description: '~10–30 min · Claude Code on the web drafts an advanced plan...',
  argumentHint: '<prompt>',
  isEnabled: () => process.env.USER_TYPE === 'ant',  // 僅 ant 用戶可用
}
```

> 注意：`isEnabled` 檢查 `USER_TYPE === 'ant'`（Anthropic 內部用戶），這是命令級限制。關鍵字觸發路徑沒有此限制，只要 feature flag 開啓即可。

### 3.3 核心命令實現 — `src/commands/ultraplan.tsx`

#### 3.3.1 入口函數 `call()`

處理 `/ultraplan <prompt>` 斜槓命令：

1. **無參數呼叫**：顯示使用幫助文本
2. **已有活躍會話**：返回 "already polling" 提示
3. **正常呼叫**：設置 `ultraplanLaunchPending` 狀態，觸發 `UltraplanLaunchDialog` 對話框

#### 3.3.2 `launchUltraplan()`

公共啓動入口，被三個路徑共享：
- 斜槓命令 (`/ultraplan`)
- 關鍵字觸發 (`processUserInput.ts`)
- Plan 審批對話框的 "Ultraplan" 按鈕 (`ExitPlanModePermissionRequest`)

關鍵邏輯：
1. 防重入檢查（`ultraplanSessionUrl` / `ultraplanLaunching`）
2. 同步設置 `ultraplanLaunching = true` 防止競態
3. 異步呼叫 `launchDetached()`
4. 立即返回啓動訊息（不等遠程會話建立）

#### 3.3.3 `launchDetached()`

異步後臺流程：

1. **取得模型**：從 GrowthBook 讀取 `tengu_ultraplan_model`，預設 `opus46` 的 firstParty ID
2. **資格檢查**：`checkRemoteAgentEligibility()` — 驗證用戶是否有權限使用遠程 agent
3. **構建提示詞**：`buildUltraplanPrompt(blurb, seedPlan)`
   - 如有 `seedPlan`（來自 plan 審批對話框），作爲草稿前綴
   - 加載 `prompt.txt` 中的指令模板
   - 附加用戶 blurb
4. **建立遠程會話**：`teleportToRemote()`
   - `permissionMode: 'plan'` — 遠程以 plan 模式執行
   - `ultraplan: true` — 標記爲 ultraplan 會話
   - `useDefaultEnvironment: true` — 使用預設雲端環境
5. **註冊任務**：`registerRemoteAgentTask()` 建立 `RemoteAgentTask` 追蹤條目
6. **啓動輪詢**：`startDetachedPoll()` 後臺輪詢審批狀態

#### 3.3.4 提示詞構建

```
buildUltraplanPrompt(blurb, seedPlan?)
```

- `prompt.txt`：當前爲空文件（反編譯丟失），原始內容應包含指導遠程 agent 生成計劃的系統指令
- 開發者可通過 `ULTRAPLAN_PROMPT_FILE` 環境變量覆蓋提示詞文件（僅 `USER_TYPE=ant` 時生效）

#### 3.3.5 `startDetachedPoll()`

後臺輪詢管理：

1. 呼叫 `pollForApprovedExitPlanMode()` 等待計劃審批
2. 階段變化時更新 `RemoteAgentTask.ultraplanPhase`（UI 展示）
3. 審批完成後的兩種路徑：
   - **`executionTarget: 'remote'`**：用戶選擇在雲端執行
     - 標記任務完成
     - 清除 `ultraplanSessionUrl`
     - 發送通知：結果將以 PR 形式提交
   - **`executionTarget: 'local'`**：用戶選擇傳送回本地（teleport）
     - 設置 `ultraplanPendingChoice`
     - 觸發 `UltraplanChoiceDialog` 對話框
4. 失敗時：歸檔遠程會話、清除狀態、發送錯誤通知

#### 3.3.6 `stopUltraplan()`

用戶主動停止：

1. `RemoteAgentTask.kill()` 歸檔遠程會話
2. 清除所有 ultraplan 狀態（`ultraplanSessionUrl`、`ultraplanPendingChoice`、`ultraplanLaunching`）
3. 發送停止通知

### 3.4 CCR 會話輪詢 — `src/utils/ultraplan/ccrSession.ts`

#### 3.4.1 `ExitPlanModeScanner`

純狀態機，無 I/O。攝入 `SDKMessage[]` 事件批次，分類 `ExitPlanMode` 工具呼叫的結果。

**狀態類型**：

```typescript
type ScanResult =
  | { kind: 'approved' }   // 用戶批准了計劃
  | { kind: 'teleport' }   // 用戶點擊"傳送回本地"
  | { kind: 'rejected' }   // 用戶拒絕（可繼續迭代）
  | { kind: 'pending' }    // 等待用戶審批中
  | { kind: 'terminated' } // 遠程會話意外終止
  | { kind: 'unchanged' }  // 無新事件，狀態不變
```

**優先級**：approved > terminated > rejected > pending > unchanged

**關鍵設計**：
- 同一批事件可能包含審批和後續崩潰 — 不丟棄已審批的計劃
- 拒絕後重新掃描（`rescanAfterRejection`），因爲新事件可能包含修改後的計劃
- 使用 `is_error: true` 判斷拒絕，`content` 中查找標記提取計劃文本

#### 3.4.2 `pollForApprovedExitPlanMode()`

輪詢主循環：

- **輪詢間隔**：3 秒
- **超時**：30 分鐘
- **容錯**：連續 5 次網絡錯誤才放棄
- **階段推斷**：
  - `hasPendingPlan`（有 ExitPlanMode 無結果）→ `plan_ready`
  - `quietIdle`（空閒且無新事件）→ `needs_input`（遠程在等用戶輸入）
  - 其他 → `running`

#### 3.4.3 計劃文本提取

兩種提取路徑：

1. **Approved**：從 `tool_result` 中查找 `## Approved Plan:\n` 或 `## Approved Plan (edited by user):\n` 標記
2. **Teleport**：從 `tool_result` 中查找 `__ULTRAPLAN_TELEPORT_SENTINEL__` 標記（瀏覽器端嵌入）

### 3.5 輸入處理集成 — `src/utils/processUserInput/processUserInput.ts`

關鍵字觸發路徑（在斜槓命令處理之前）：

```typescript
if (feature('ULTRAPLAN') &&
    mode === 'prompt' &&               // 非非交互模式
    !isNonInteractiveSession &&         // 非後臺會話
    inputString !== null &&
    !inputString.startsWith('/') &&     // 非斜槓命令
    !ultraplanSessionUrl &&             // 無活躍會話
    !ultraplanLaunching &&              // 非正在啓動
    hasUltraplanKeyword(inputString)) {
  // 重寫爲 /ultraplan 命令
  const rewritten = replaceUltraplanKeyword(inputString).trim()
  await processSlashCommand(`/ultraplan ${rewritten}`, ...)
}
```

### 3.6 UI 層

#### 3.6.1 彩虹高亮 — `src/components/PromptInput/PromptInput.tsx`

當輸入中檢測到 `ultraplan` 關鍵字時：
- 對每個字符施加**彩虹漸變色**高亮（`getRainbowColor()`）
- 顯示通知："This prompt will launch an ultraplan session in Claude Code on the web"

#### 3.6.2 預啓動對話框 — `UltraplanLaunchDialog`

在 REPL 的 `focusedInputDialog === 'ultraplan-launch'` 時渲染。

用戶選擇：
- **確認**：呼叫 `launchUltraplan()`，先添加命令回顯，異步啓動遠程會話
- **取消**：清除 `ultraplanLaunchPending` 狀態

#### 3.6.3 計劃選擇對話框 — `UltraplanChoiceDialog`

在 `focusedInputDialog === 'ultraplan-choice'` 時渲染。

當 teleport 路徑返回已審批計劃時，用戶可選擇執行方式。

#### 3.6.4 Plan 審批按鈕 — `ExitPlanModePermissionRequest`

本地 Plan Mode 的審批對話框中，如果 `feature('ULTRAPLAN')` 開啓，會顯示額外的 "Ultraplan" 按鈕：
- 將當前本地計劃作爲 `seedPlan` 發送給遠程
- 按鈕僅在無活躍 ultraplan 會話時顯示

### 3.7 應用狀態 — `src/state/AppStateStore.ts`

```typescript
interface AppState {
  ultraplanLaunching?: boolean    // 防重入鎖（5 秒窗口）
  ultraplanSessionUrl?: string    // 活躍遠程會話 URL
  ultraplanPendingChoice?: {      // 已審批計劃等待選擇
    plan: string
    sessionId: string
    taskId: string
  }
  ultraplanLaunchPending?: {      // 預啓動對話框
    blurb: string
  }
  isUltraplanMode?: boolean       // 遠程端：CCR 側的 ultraplan 標記
}
```

### 3.8 遠程任務追蹤 — `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`

Ultraplan 使用 `RemoteAgentTask` 基礎設施追蹤遠程會話：

```typescript
registerRemoteAgentTask({
  remoteTaskType: 'ultraplan',
  session: { id, title },
  command: blurb,
  isUltraplan: true  // 特殊標記，跳過通用輪詢邏輯
})
```

`extractPlanFromLog()` 從 `<ultraplan>...</ultraplan>` XML 標籤中提取計劃內容。

---

## 四、資料流時序

```
時間線 →

用戶                    本地 CLI                     CCR 雲端
 │                       │                             │
 │ "ultraplan xxx"       │                             │
 │──────────────────────>│                             │
 │                       │ keyword 檢測 + 重寫          │
 │                       │ /ultraplan "plan xxx"        │
 │                       │                             │
 │  [UltraplanLaunch     │                             │
 │   Dialog]             │                             │
 │──── confirm ─────────>│                             │
 │                       │ launchDetached()             │
 │                       │─────────────────────────────>│
 │                       │  teleportToRemote()          │
 │                       │  (permissionMode: 'plan')    │
 │                       │                             │
 │  "Starting..."        │                             │
 │<──────────────────────│                             │
 │                       │                             │
 │  (終端空閒，可繼續)    │  startDetachedPoll()        │
 │                       │  ═══ 3s 輪詢循環 ═══         │
 │                       │                             │
 │                       │                   [瀏覽器打開]│
 │                       │                   [雲端生成計劃]
 │                       │                             │
 │                       │  ← needs_input ─────────────│
 │                       │    (雲端追問用戶)             │
 │                       │                             │
 │                       │                   [用戶在瀏覽器回覆]
 │                       │                             │
 │                       │  ← plan_ready ──────────────│
 │                       │    (ExitPlanMode 等待審批)    │
 │                       │                             │
 │                       │                   [用戶審批/編輯]
 │                       │                             │
 │               ┌───────┤  ← approved ────────────────│
 │               │       │                             │
 │    [遠程執行]  │       │                             │
 │    通知完成    │       │                             │
 │               │       │                             │
 │               └── OR ─┤  ← teleport ───────────────│
 │                       │                             │
 │  [UltraplanChoice     │                             │
 │   Dialog]             │                             │
 │── 選擇執行方式 ───────>│                             │
 │                       │ 本地執行計劃                  │
```

---

## 五、關鍵文件清單

| 文件 | 職責 |
|------|------|
| `src/utils/ultraplan/keyword.ts` | 關鍵字檢測、高亮位置計算、關鍵字替換 |
| `src/utils/ultraplan/ccrSession.ts` | CCR 會話輪詢、ExitPlanMode 狀態機、計劃文本提取 |
| `src/utils/ultraplan/prompt.txt` | 遠程指令模板（當前爲空，需重建） |
| `src/commands/ultraplan.tsx` | `/ultraplan` 命令、啓動/停止邏輯、提示詞構建 |
| `src/utils/processUserInput/processUserInput.ts` | 關鍵字觸發 → `/ultraplan` 命令路由 |
| `src/components/PromptInput/PromptInput.tsx` | 彩虹高亮 + 通知提示 |
| `src/screens/REPL.tsx` | 對話框渲染（UltraplanLaunchDialog / UltraplanChoiceDialog） |
| `src/components/permissions/ExitPlanModePermissionRequest/` | Plan 審批中的 "Ultraplan" 按鈕 |
| `src/state/AppStateStore.ts` | ultraplan 相關狀態字段定義 |
| `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | 遠程任務追蹤 + `<ultraplan>` 標籤提取 |
| `src/constants/xml.ts` | `ULTRAPLAN_TAG = 'ultraplan'` |

---

## 六、依賴關係

### 外部依賴

| 依賴 | 用途 | 必要性 |
|------|------|--------|
| `teleportToRemote()` | 建立 CCR 雲端會話 | 必須 — 核心功能 |
| `checkRemoteAgentEligibility()` | 驗證用戶遠程 agent 使用資格 | 必須 — 前置檢查 |
| `archiveRemoteSession()` | 歸檔/終止遠程會話 | 必須 — 清理 |
| GrowthBook `tengu_ultraplan_model` | 取得使用的模型 ID | 可選 — 預設 opus46 |
| `@anthropic-ai/sdk` | SDKMessage 類型 | 必須 — 類型定義 |
| `pollRemoteSessionEvents()` | 事件流分頁輪詢 | 必須 — 輪詢基礎設施 |

### 內部依賴

- **ExitPlanModeV2Tool**：遠程端呼叫的工具，觸發 plan 審批流程
- **RemoteAgentTask**：任務追蹤和狀態管理基礎設施
- **AppState Store**：ultraplan 狀態管理

---

## 七、當前狀態與補全要點

| 組件 | 狀態 | 說明 |
|------|------|------|
| 關鍵字檢測 | ✅ 完整 | `keyword.ts` 邏輯完善 |
| 命令框架 | ✅ 完整 | 註冊、路由、防重入完整 |
| 啓動流程 | ✅ 完整 | `launchUltraplan` / `launchDetached` 完整 |
| CCR 輪詢 | ✅ 完整 | `ccrSession.ts` 狀態機完整 |
| UI 高亮/通知 | ✅ 完整 | 彩虹高亮 + 提示通知完整 |
| 狀態管理 | ✅ 完整 | AppState 字段完整 |
| `prompt.txt` | ❌ 空文件 | 需要重建遠程指令模板 |
| `UltraplanLaunchDialog` | ⚠️ 全局聲明 | 組件實現未找到（可能在內置包中） |
| `UltraplanChoiceDialog` | ⚠️ 全局聲明 | 組件實現未找到（可能在內置包中） |
| `isEnabled` 限制 | ⚠️ `USER_TYPE === 'ant'` | 命令級限制，僅 Anthropic 內部用戶 |

### 補全建議

1. **重建 `prompt.txt`**：這是遠程 agent 的核心指令，定義如何進行多 agent 探索式規劃。需要設計：
   - 規劃方法論（多角度分析、風險評估、分階段執行）
   - ExitPlanMode 工具的使用引導
   - 輸出格式要求

2. **對話框組件**：`UltraplanLaunchDialog` 和 `UltraplanChoiceDialog` 在 `global.d.ts` 中聲明但實現缺失，需要新建：
   - Launch Dialog：確認對話框（含 CCR 使用條款連結）
   - Choice Dialog：展示已審批計劃 + 執行方式選擇

3. **放寬 `isEnabled`**：如果要讓非 ant 用戶使用斜槓命令，需移除 `USER_TYPE === 'ant'` 檢查

---

## 八、與相關 Feature 的關係

| Feature | 關係 |
|---------|------|
| `ULTRATHINK` | 類似的高能力模式，但 `ULTRATHINK` 只調高 effort，不啓動遠程會話 |
| `FORK_SUBAGENT` | Ultraplan 不使用 fork subagent，使用的是 CCR 遠程 agent |
| `COORDINATOR_MODE` | 不同範式的多 agent，Coordinator 在本地編排，Ultraplan 在雲端 |
| `BRIDGE_MODE` | 底層依賴相同的 `teleportToRemote()` 基礎設施 |
| `ExitPlanModeTool` | 遠程端的審批機制，Ultraplan 的核心交互模型 |
