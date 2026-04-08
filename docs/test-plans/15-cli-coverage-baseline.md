# Plan 15 — CLI 參數測試 + 覆蓋率基線

> 優先級：低 | 預估 ~15 個測試用例

---

## 15.1 `src/main.tsx` CLI 參數測試

**目標**：覆蓋 Commander.js 設定的參數解析和模式切換。

### 前置條件

`src/main.tsx` 的 Commander 實例通常在模組頂層建立。測試策略：
- 直接構造 Commander 實例或 mock `main.tsx` 的 program 導出
- 使用 `parseArgs` 而非 `parse`（不觸發 `process.exit`）

### 用例

| # | 用例 | 輸入 | 期望 |
|---|------|------|------|
| 1 | 預設模式 | `[]` | 模式爲 REPL |
| 2 | pipe 模式 | `["-p"]` | 模式爲 pipe |
| 3 | pipe 帶輸入 | `["-p", "say hello"]` | 輸入爲 `"say hello"` |
| 4 | print 模式 | `["--print", "hello"]` | 等效於 pipe |
| 5 | verbose | `["-v"]` | verbose 標誌爲 true |
| 6 | model 選擇 | `["--model", "claude-opus-4-6"]` | model 值正確傳遞 |
| 7 | system prompt | `["--system-prompt", "custom"]` | system prompt 被設置 |
| 8 | help | `["--help"]` | 顯示幫助信息，不報錯 |
| 9 | version | `["--version"]` | 顯示版本號 |
| 10 | unknown flag | `["--nonexistent"]` | 不報錯（Commander 允許未知參數時） |

> **風險**：`main.tsx` 可能執行初始化邏輯（auth、analytics），需要在 mock 環境中執行。如果複雜度過高，降級爲只測試參數解析部分。

---

## 15.2 覆蓋率基線

### 執行命令

```bash
bun test --coverage 2>&1 | tail -50
```

### 記錄內容

| 模組 | 當前覆蓋率 | 目標 |
|------|-----------|------|
| `src/utils/` | 待測量 | >= 80% |
| `src/utils/permissions/` | 待測量 | >= 60% |
| `src/utils/model/` | 待測量 | >= 60% |
| `src/Tool.ts` + `src/tools.ts` | 待測量 | >= 80% |
| `src/utils/claudemd.ts` | 待測量 | >= 40%（核心邏輯難測） |
| 整體 | 待測量 | 不設強制指標 |

### 後續行動

- 將基線資料填入 `testing-spec.md` §4
- 識別覆蓋率最低的 10 個文件，排入後續測試計劃
- 如 `bun test --coverage` 輸出不可用（Bun 版本限制），改用手動計算已測/總導出函數比

---

## 驗收標準

- [ ] CLI 參數至少覆蓋 5 個核心 flag
- [ ] 覆蓋率基線資料記錄到 testing-spec.md
- [ ] `bun test` 全部通過
