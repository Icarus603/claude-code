# Plan 12 — Mock 可靠性修復

> 優先級：高 | 影響 4 個測試文件 | 預估修改 ~15 處

本計劃修復測試中 mock 相關的副作用、狀態泄漏和虛假測試。

---

## 12.1 `gitOperationTracking.test.ts` — 消除分析副作用

**當前問題**：`detectGitOperation` 內部呼叫 `logEvent()`、`getCommitCounter().increment()`、`getPrCounter().increment()`，每次測試執行都觸發真實分析程式碼。

**修復步驟**：

1. 讀取 `src/tools/shared/gitOperationTracking.ts`，確認 analytics 導入路徑
2. 在測試文件頂部添加 `mock.module`：

```typescript
import { mock } from "bun:test";

mock.module("src/services/analytics/index.ts", () => ({
  logEvent: mock(() => {}),
  // 按需補充其他導出
}));
```

3. 如果 `getCommitCounter` / `getPrCounter` 來自 `src/bootstrap/state.ts`：

```typescript
mock.module("src/bootstrap/state.ts", () => ({
  getCommitCounter: mock(() => ({ increment: mock(() => {}) })),
  getPrCounter: mock(() => ({ increment: mock(() => {}) })),
  // 保留其他被測函數實際需要的導出
}));
```

4. 使用 `await import()` 模式加載被測模組
5. 執行測試驗證無副作用

**風險**：`mock.module` 會替換整個模組。如果 `detectGitOperation` 還需要其他來自這些模組的導出，需在 mock 工廠中提供。

---

## 12.2 `PermissionMode.test.ts` — 修復 `isExternalPermissionMode` 虛假測試

**當前問題**：`isExternalPermissionMode` 依賴 `process.env.USER_TYPE`。非 ant 環境下所有 mode 都返回 true，測試從未覆蓋 false 分支。

**修復步驟**：

1. 新增 ant 環境測試組（見 Plan 10.3 詳細用例）
2. 使用 `beforeEach`/`afterEach` 管理 `process.env.USER_TYPE`

```typescript
describe("when USER_TYPE is 'ant'", () => {
  const originalUserType = process.env.USER_TYPE;
  beforeEach(() => { process.env.USER_TYPE = "ant"; });
  afterEach(() => {
    if (originalUserType !== undefined) {
      process.env.USER_TYPE = originalUserType;
    } else {
      delete process.env.USER_TYPE;
    }
  });

  test("returns false for 'auto'", () => {
    expect(isExternalPermissionMode("auto")).toBe(false);
  });
  test("returns false for 'bubble'", () => {
    expect(isExternalPermissionMode("bubble")).toBe(false);
  });
  test("returns true for 'plan'", () => {
    expect(isExternalPermissionMode("plan")).toBe(true);
  });
});
```

3. 驗證新增測試確實執行 false 路徑

---

## 12.3 `providers.test.ts` — 環境變量快照恢復

**當前問題**：
- `originalEnv` 聲明後未使用
- `afterEach` 僅刪除已知 3 個 key，如果源碼新增 env var，測試間狀態泄漏

**修復步驟**：

```typescript
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of Object.keys(process.env)) {
    savedEnv[key] = process.env[key];
  }
});

afterEach(() => {
  // 刪除所有當前 env，恢復快照
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});
```

> 簡化方案：只保存/恢復相關 key 列表 `["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "ANTHROPIC_BASE_URL", "USER_TYPE"]`，但需註釋說明新增 env var 時需同步更新。

---

## 12.4 `envUtils.test.ts` — 驗證環境變量恢復完整性

**當前狀態**：已有 `afterEach` 恢復。需審查：

1. 確認所有 `describe` 塊中的 `afterEach` 都完整恢復了修改的 env var
2. 確認 `process.argv` 修改也被恢復（`getClaudeConfigHomeDir` 測試修改了 argv）
3. 新增：`afterEach` 中斷言無意外 env 泄漏（可選，CI-only）

---

## 12.5 `sleep.test.ts` / `memoize.test.ts` — 時間敏感測試加固

**當前狀態**：已有合理 margin。可選加固：

| 文件 | 用例 | 當前 | 加固 |
|------|------|------|------|
| `sleep.test.ts` | `resolves after timeout` | `sleep(50)`, check `>= 40ms` | 增大 margin：`sleep(50)`, check `>= 30ms` |
| `memoize.test.ts` | stale serve & refresh | TTL=1ms, wait 10ms | 增大 margin：TTL=5ms, wait 50ms |

> 僅在 CI 出現 flaky 時執行此加固。

---

## 驗收標準

- [ ] `gitOperationTracking.test.ts` 無分析副作用（可通過在 mock 中增加 `expect(logEvent).toHaveBeenCalledTimes(N)` 驗證）
- [ ] `PermissionMode.test.ts` 的 `isExternalPermissionMode` 覆蓋 true + false 分支
- [ ] `providers.test.ts` 的 `originalEnv` 死程式碼已刪除
- [ ] 所有修改 env 的測試文件恢復完整
- [ ] `bun test` 全部通過
