# Plan 10 — 修復 WEAK 評分測試文件

> 優先級：高 | 8 個文件 | 預估新增/修改 ~60 個測試用例

本計劃修復 testing-spec.md 中評定爲 WEAK 的 8 個測試文件的斷言缺陷和覆蓋缺口。

---

## 10.1 `src/utils/__tests__/format.test.ts`

**問題**：`formatNumber`、`formatTokens`、`formatRelativeTime` 使用 `toContain` 代替精確匹配，無法檢測格式迴歸。

### 修改清單

#### formatNumber — toContain → toBe

```typescript
// 當前（弱）
expect(formatNumber(1321)).toContain("k");
expect(formatNumber(1500000)).toContain("m");

// 修復爲
expect(formatNumber(1321)).toBe("1.3k");
expect(formatNumber(1500000)).toBe("1.5m");
```

> 注意：`Intl.NumberFormat` 輸出可能因 locale 不同。若 CI locale 不一致，改用 `toMatch(/^\d+(\.\d)?[km]$/)` 正則匹配。

#### formatTokens — 補精確斷言

```typescript
expect(formatTokens(1000)).toBe("1k");
expect(formatTokens(1500)).toBe("1.5k");
```

#### formatRelativeTime — toContain → toBe

```typescript
// 當前（弱）
expect(formatRelativeTime(diff, now)).toContain("30");
expect(formatRelativeTime(diff, now)).toContain("ago");

// 修復爲
expect(formatRelativeTime(diff, now)).toBe("30s ago");
```

#### 新增：formatDuration 進位邊界

| 用例 | 輸入 | 期望 |
|------|------|------|
| 59.5s 進位 | 59500ms | 至少含 `1m` |
| 59m59s 進位 | 3599000ms | 至少含 `1h` |
| sub-millisecond | 0.5ms | `"<1ms"` 或 `"0ms"` |

#### 新增：未測試函數

| 函數 | 最少用例 |
|------|---------|
| `formatRelativeTimeAgo` | 2（過去 / 未來） |
| `formatLogMetadata` | 1（基本呼叫不拋錯） |
| `formatResetTime` | 2（有值 / null） |
| `formatResetText` | 1（基本呼叫） |

---

## 10.2 `src/tools/shared/__tests__/gitOperationTracking.test.ts`

**問題**：`detectGitOperation` 內部呼叫 `getCommitCounter()`、`getPrCounter()`、`logEvent()`，測試產生分析副作用。

### 修改清單

#### 添加 analytics mock

在文件頂部添加 `mock.module`：

```typescript
import { mock, afterAll, afterEach, beforeEach } from "bun:test";

mock.module("src/services/analytics/index.ts", () => ({
  logEvent: mock(() => {}),
}));

mock.module("src/bootstrap/state.ts", () => ({
  getCommitCounter: mock(() => ({ increment: mock(() => {}) })),
  getPrCounter: mock(() => ({ increment: mock(() => {}) })),
}));
```

> 需驗證 `detectGitOperation` 的實際導入路徑，按需調整 mock 目標。

#### 新增：缺失的 GH PR actions

| 用例 | 輸入 | 期望 |
|------|------|------|
| gh pr edit | `'gh pr edit 123 --title "fix"'` | `result.pr.number === 123` |
| gh pr close | `'gh pr close 456'` | `result.pr.number === 456` |
| gh pr ready | `'gh pr ready 789'` | `result.pr.number === 789` |
| gh pr comment | `'gh pr comment 123 --body "done"'` | `result.pr.number === 123` |

#### 新增：parseGitCommitId 邊界

| 用例 | 輸入 | 期望 |
|------|------|------|
| 完整 40 字符 SHA | `'[abcdef0123456789abcdef0123456789abcdef01] ...'` | 返回完整 40 字符 |
| 畸形括號輸出 | `'create mode 100644 file.txt'` | 返回 `null` |

---

## 10.3 `src/utils/permissions/__tests__/PermissionMode.test.ts`

**問題**：`isExternalPermissionMode` 在非 ant 環境永遠返回 true，false 路徑從未執行；mode 覆蓋不完整。

### 修改清單

#### 補全 mode 覆蓋

| 函數 | 缺失的 mode |
|------|-------------|
| `permissionModeTitle` | `bypassPermissions`, `dontAsk` |
| `permissionModeShortTitle` | `dontAsk`, `acceptEdits` |
| `getModeColor` | `dontAsk`, `acceptEdits`, `plan` |
| `permissionModeFromString` | `acceptEdits`, `bypassPermissions` |
| `toExternalPermissionMode` | `acceptEdits`, `bypassPermissions` |

#### 修復 isExternalPermissionMode

```typescript
// 當前：只測了非 ant 環境（永遠 true）
// 需要新增 ant 環境測試
describe("when USER_TYPE is 'ant'", () => {
  beforeEach(() => {
    process.env.USER_TYPE = "ant";
  });
  afterEach(() => {
    delete process.env.USER_TYPE;
  });

  test("returns false for 'auto' in ant context", () => {
    expect(isExternalPermissionMode("auto")).toBe(false);
  });

  test("returns false for 'bubble' in ant context", () => {
    expect(isExternalPermissionMode("bubble")).toBe(false);
  });

  test("returns true for non-ant modes in ant context", () => {
    expect(isExternalPermissionMode("plan")).toBe(true);
  });
});
```

#### 新增：permissionModeSchema

| 用例 | 輸入 | 期望 |
|------|------|------|
| 有效 mode | `'plan'` | `success: true` |
| 無效 mode | `'invalid'` | `success: false` |

---

## 10.4 `src/utils/permissions/__tests__/dangerousPatterns.test.ts`

**問題**：純資料 smoke test，無行爲驗證。

### 修改清單

#### 新增：重複值檢查

```typescript
test("CROSS_PLATFORM_CODE_EXEC has no duplicates", () => {
  const set = new Set(CROSS_PLATFORM_CODE_EXEC);
  expect(set.size).toBe(CROSS_PLATFORM_CODE_EXEC.length);
});

test("DANGEROUS_BASH_PATTERNS has no duplicates", () => {
  const set = new Set(DANGEROUS_BASH_PATTERNS);
  expect(set.size).toBe(DANGEROUS_BASH_PATTERNS.length);
});
```

#### 新增：全量成員斷言（用 Set 確保精確）

```typescript
test("CROSS_PLATFORM_CODE_EXEC contains expected interpreters", () => {
  const expected = ["node", "python", "python3", "ruby", "perl", "php",
    "bun", "deno", "npx", "tsx"];
  const set = new Set(CROSS_PLATFORM_CODE_EXEC);
  for (const entry of expected) {
    expect(set.has(entry)).toBe(true);
  }
});
```

#### 新增：空字符串不匹配

```typescript
test("empty string does not match any pattern", () => {
  for (const pattern of DANGEROUS_BASH_PATTERNS) {
    expect("".startsWith(pattern)).toBe(false);
  }
});
```

---

## 10.5 `src/utils/__tests__/zodToJsonSchema.test.ts`

**問題**：object 屬性僅 `toBeDefined` 未驗證類型結構；optional 字段未驗證 absence。

### 修改清單

#### 修復 object schema 測試

```typescript
// 當前（弱）
expect(schema.properties!.name).toBeDefined();
expect(schema.properties!.age).toBeDefined();

// 修復爲
expect(schema.properties!.name).toEqual({ type: "string" });
expect(schema.properties!.age).toEqual({ type: "number" });
```

#### 修復 optional 字段測試

```typescript
test("optional field is not in required array", () => {
  const schema = zodToJsonSchema(z.object({
    required: z.string(),
    optional: z.string().optional(),
  }));
  expect(schema.required).toEqual(["required"]);
  expect(schema.required).not.toContain("optional");
});
```

#### 新增：缺失的 schema 類型

| 用例 | 輸入 | 期望 |
|------|------|------|
| `z.literal("foo")` | `z.literal("foo")` | `{ const: "foo" }` |
| `z.null()` | `z.null()` | `{ type: "null" }` |
| `z.union()` | `z.union([z.string(), z.number()])` | `{ anyOf: [...] }` |
| `z.record()` | `z.record(z.string(), z.number())` | `{ type: "object", additionalProperties: { type: "number" } }` |
| `z.tuple()` | `z.tuple([z.string(), z.number()])` | `{ type: "array", items: [...], additionalItems: false }` |
| 嵌套 object | `z.object({ a: z.object({ b: z.string() }) })` | 驗證嵌套屬性結構 |

---

## 10.6 `src/utils/__tests__/envValidation.test.ts`

**問題**：`validateBoundedIntEnvVar` lower bound=100 時 value=1 返回 `status: "valid"`，疑似源碼 bug。

### 修改清單

#### 驗證 lower bound 行爲

```typescript
// 當前測試
test("value of 1 with lower bound 100", () => {
  const result = validateBoundedIntEnvVar("1", { defaultValue: 100, upperLimit: 1000, lowerLimit: 100 });
  // 如果源碼有 bug，這裏應該暴露
  expect(result.effective).toBeGreaterThanOrEqual(100);
  expect(result.status).toBe(result.effective !== 100 ? "capped" : "valid");
});
```

#### 新增邊界用例

| 用例 | value | lowerLimit | 期望 |
|------|-------|------------|------|
| 低於 lower bound | `"50"` | 100 | `effective: 100, status: "capped"` |
| 等於 lower bound | `"100"` | 100 | `effective: 100, status: "valid"` |
| 浮點截斷 | `"50.7"` | 100 | `effective: 100`（parseInt 截斷後 cap） |
| 空白字符 | `" 500 "` | 1 | `effective: 500, status: "valid"` |
| defaultValue 爲 0 | `"0"` | 0 | 需確認 `parsed <= 0` 邏輯 |

> **行動**：先確認 `validateBoundedIntEnvVar` 源碼中 lower bound 的實際執行路徑。如果確實不生效，需先修源碼再補測試。

---

## 10.7 `src/utils/__tests__/file.test.ts`

**問題**：`addLineNumbers` 僅 `toContain`，未驗證完整格式。

### 修改清單

#### 修復 addLineNumbers 斷言

```typescript
// 當前（弱）
expect(result).toContain("1");
expect(result).toContain("hello");

// 修復爲（需確定 isCompactLinePrefixEnabled 行爲）
// 假設 compact=false，格式爲 "     1→hello"
test("formats single line with tab prefix", () => {
  // 先確認環境，如果 compact 模式不確定，用正則
  expect(result).toMatch(/^\s*\d+[→\t]hello$/m);
});
```

#### 新增：stripLineNumberPrefix 邊界

| 用例 | 輸入 | 期望 |
|------|------|------|
| 純數字行 | `"123"` | `""` |
| 無內容前綴 | `"→"` | `""` |
| compact 格式 `"1\thello"` | `"1\thello"` | `"hello"` |

#### 新增：pathsEqual 邊界

| 用例 | a | b | 期望 |
|------|---|---|------|
| 尾部斜槓差異 | `"/a/b"` | `"/a/b/"` | `false` |
| `..` 段 | `"/a/../b"` | `"/b"` | 視實現而定 |

---

## 10.8 `src/utils/__tests__/notebook.test.ts`

**問題**：`mapNotebookCellsToToolResult` 內容檢查用 `toContain`，未驗證 XML 格式。

### 修改清單

#### 修復 content 斷言

```typescript
// 當前（弱）
expect(result).toContain("cell-0");
expect(result).toContain("print('hello')");

// 修復爲
expect(result).toContain('<cell id="cell-0">');
expect(result).toContain("</cell>");
```

#### 新增：parseCellId 邊界

| 用例 | 輸入 | 期望 |
|------|------|------|
| 負數 | `"cell--1"` | `null` |
| 前導零 | `"cell-007"` | `7` |
| 極大數 | `"cell-999999999"` | `999999999` |

#### 新增：mapNotebookCellsToToolResult 邊界

| 用例 | 輸入 | 期望 |
|------|------|------|
| 空 data 數組 | `{ cells: [] }` | 空字符串或空結果 |
| 無 cell_id | `{ cell_type: "code", source: "x" }` | fallback 到 `cell-${index}` |
| error output | `{ output_type: "error", ename: "Error", evalue: "msg" }` | 包含 error 信息 |

---

## 驗收標準

- [ ] `bun test` 全部通過
- [ ] 8 個文件評分從 WEAK 提升至 ACCEPTABLE 或 GOOD
- [ ] `toContain` 僅用於警告文本等確實不確定精確值的場景
- [ ] envValidation bug 確認並修復（或確認非 bug 並更新測試）
