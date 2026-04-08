# Phase 18 — WEAK 修復 + ACCEPTABLE 加固

> 建立日期：2026-04-02
> 預計：+30 tests / 4 files (修改現有)
> 目標：修復所有 WEAK 評分測試文件，消除系統性問題

---

## 18.1 `src/utils/__tests__/format.test.ts` — 斷言精確化（+5 tests）

**問題**: `formatNumber`/`formatTokens`/`formatRelativeTime` 使用 `toContain`
**修復**: 改爲 `toBe` 精確匹配

```diff
- expect(formatNumber(1500000)).toContain("1.5")
+ expect(formatNumber(1500000)).toBe("1.5m")
```

新增測試：

| 測試用例 | 驗證點 |
|---------|--------|
| formatNumber — 0 | `"0"` |
| formatNumber — billions | `"1.5b"` |
| formatTokens — thousands | 精確匹配 |
| formatRelativeTime — hours ago | 精確匹配 |
| formatRelativeTime — days ago | 精確匹配 |

---

## 18.2 `src/utils/__tests__/envValidation.test.ts` — Bug 確認（+3 tests）

**問題**: `value=1, lowerBound=100` 返回 `status: "valid"` — 函數名暗示有下界檢查
**計劃**: 先讀取源碼確認 `defaultValue` 和 `lowerBound` 的語義關係，然後：
- 如果是源碼 bug → 在測試中註釋標記，不修改源碼
- 如果是設計意圖 → 更新測試描述明確語義

新增測試：

| 測試用例 | 驗證點 |
|---------|--------|
| parseFloat truncation | `"50.9"` → 50 |
| whitespace handling | `" 500 "` → 500 |
| very large number | overflow 處理 |

---

## 18.3 `src/utils/permissions/__tests__/PermissionMode.test.ts` — false 路徑（+8 tests）

**問題**: `isExternalPermissionMode` false 路徑從未執行
**修復**: 覆蓋所有 5 種 mode 的 true/false 期望

| 測試用例 | 驗證點 |
|---------|--------|
| isExternalPermissionMode — plan | false |
| isExternalPermissionMode — auto | false |
| isExternalPermissionMode — default | false |
| permissionModeFromString — all modes | 5 種 mode 全覆蓋 |
| permissionModeFromString — invalid | 預設值 |
| permissionModeFromString — case insensitive | 大小寫 |
| isPermissionMode — valid strings | true |
| isPermissionMode — invalid strings | false |

---

## 18.4 `src/tools/shared/__tests__/gitOperationTracking.test.ts` — mock analytics（+4 tests）

**問題**: 未 mock analytics 依賴，測試產生副作用
**修復**: 添加 `mock.module("src/services/analytics/...", ...)`

新增測試：

| 測試用例 | 驗證點 |
|---------|--------|
| parseGitCommitId — all GH PR actions | 補齊 6 個 action |
| detectGitOperation — no analytics call | mock 驗證 |
| detectGitCommitId — various formats | SHA/短 SHA/HEAD |
| git operation tracking — edge cases | 空輸入、畸形輸入 |

---

## 排除清單

以下模組 **不納入測試**，原因合理：

| 模組 | 行數 | 排除原因 |
|------|------|---------|
| `query.ts` | 1732 | 核心循環，40+ 依賴，需完整集成環境 |
| `QueryEngine.ts` | 1320 | 編排器，30+ 依賴 |
| `utils/hooks.ts` | 5121 | 51 exports，spawn 子進程 |
| `utils/config.ts` | 1817 | 檔案系統 + lockfile + 全局狀態 |
| `utils/auth.ts` | 2002 | 多 provider 認證，平臺特定 |
| `utils/fileHistory.ts` | 1115 | 重 I/O 文件備份 |
| `utils/sessionRestore.ts` | 551 | 恢復狀態涉及多個子系統 |
| `utils/ripgrep.ts` | 679 | spawn 子進程 |
| `utils/yaml.ts` | 15 | 兩行 wrapper |
| `utils/lockfile.ts` | 43 | trivial wrapper |
| `screens/` / `components/` | — | Ink 渲染測試環境 |
| `bridge/` / `remote/` / `ssh/` | — | 網絡層 |
| `daemon/` / `server/` | — | 進程管理 |

---

## 預期成果

| 指標 | Phase 16 後 | Phase 17 後 | Phase 18 後 |
|------|-----------|-----------|-----------|
| 測試數 | ~1417 | ~1567 | ~1597 |
| 文件數 | 76 | 87 | 91 |
| WEAK 文件 | 6 | 4 | **0** |
