# Phase 19 - Batch 4: Services 純邏輯

> 預計 ~84 tests / 5 文件 | 部分需輕量 mock

---

## 1. `src/services/compact/__tests__/grouping.test.ts` (~15 tests)

**源文件**: `src/services/compact/grouping.ts` (64 行)
**目標函數**: `groupMessagesByApiRound`

### 測試用例

```typescript
describe("groupMessagesByApiRound", () => {
  test("returns single group for single API round")
  test("splits at new assistant message ID")
  test("keeps tool_result messages with their parent assistant message")
  test("handles streaming chunks (same assistant ID stays grouped)")
  test("returns empty array for empty input")
  test("handles all user messages (no assistant)")
  test("handles alternating assistant IDs")
  test("three API rounds produce three groups")
  test("user messages before first assistant go in first group")
  test("consecutive user messages stay in same group")
  test("does not produce empty groups")
  test("handles single message")
  test("preserves message order within groups")
  test("handles system messages")
  test("tool_result after assistant stays in same round")
})
```

### Mock 需求
需構造 `Message` mock 對象（type: 'user'/'assistant', message: { id, content }）

---

## 2. `src/services/compact/__tests__/stripMessages.test.ts` (~20 tests)

**源文件**: `src/services/compact/compact.ts` (1709 行)
**目標函數**: `stripImagesFromMessages`, `collectReadToolFilePaths` (私有)

### 測試用例

```typescript
describe("stripImagesFromMessages", () => {
  // user 訊息處理
  test("replaces image block with [image] text")
  test("replaces document block with [document] text")
  test("preserves text blocks unchanged")
  test("handles multiple image/document blocks in single message")
  test("returns original message when no media blocks")

  // tool_result 內嵌套
  test("replaces image inside tool_result content")
  test("replaces document inside tool_result content")
  test("preserves non-media tool_result content")

  // 非用戶訊息
  test("passes through assistant messages unchanged")
  test("passes through system messages unchanged")

  // 邊界
  test("handles empty message array")
  test("handles string content (non-array) in user message")
  test("does not mutate original messages")
})

describe("collectReadToolFilePaths", () => {
  // 注意：這是私有函數，可能需要通過 stripImagesFromMessages 或其他導出間接測試
  // 如果不可直接測試，則跳過或通過集成測試覆蓋
  test("collects file_path from Read tool_use blocks")
  test("skips tool_use with FILE_UNCHANGED_STUB result")
  test("returns empty set for messages without Read tool_use")
  test("handles multiple Read calls across messages")
  test("normalizes paths via expandPath")
})
```

### Mock 需求
需 mock `expandPath`（如果 collectReadToolFilePaths 要測）
需 mock `log`, `slowOperations` 等重依賴
構造 `Message` mock 對象

---

## 3. `src/services/compact/__tests__/prompt.test.ts` (~12 tests)

**源文件**: `src/services/compact/prompt.ts` (375 行)
**目標函數**: `formatCompactSummary`

### 測試用例

```typescript
describe("formatCompactSummary", () => {
  test("strips <analysis>...</analysis> block")
  test("replaces <summary>...</summary> with 'Summary:\\n' prefix")
  test("handles analysis + summary together")
  test("handles summary without analysis")
  test("handles analysis without summary")
  test("collapses multiple newlines to double")
  test("trims leading/trailing whitespace")
  test("handles empty string")
  test("handles plain text without tags")
  test("handles multiline analysis content")
  test("preserves content between analysis and summary")
  test("handles nested-like tags gracefully")
})
```

### Mock 需求
需 mock 重依賴鏈（`log`, feature flags 等）
`formatCompactSummary` 是純字符串處理，如果 import 鏈不太重則無需複雜 mock

---

## 4. `src/services/mcp/__tests__/channelPermissions.test.ts` (~25 tests)

**源文件**: `src/services/mcp/channelPermissions.ts` (241 行)
**目標函數**: `hashToId`, `shortRequestId`, `truncateForPreview`, `filterPermissionRelayClients`

### 測試用例

```typescript
describe("hashToId", () => {
  test("returns 5-char string")
  test("uses only letters a-z excluding 'l'")
  test("is deterministic (same input = same output)")
  test("different inputs produce different outputs (with high probability)")
  test("handles empty string")
})

describe("shortRequestId", () => {
  test("returns 5-char string from tool use ID")
  test("is deterministic")
  test("avoids profanity substrings (retries with salt)")
  test("returns a valid ID even if all retries hit bad words (unlikely)")
})

describe("truncateForPreview", () => {
  test("returns JSON string for object input")
  test("truncates to <=200 chars when input is long")
  test("adds ellipsis or truncation indicator")
  test("returns short input unchanged")
  test("handles string input")
  test("handles null/undefined input")
})

describe("filterPermissionRelayClients", () => {
  test("keeps connected clients in allowlist with correct capabilities")
  test("filters out disconnected clients")
  test("filters out clients not in allowlist")
  test("filters out clients missing required capabilities")
  test("returns empty array for empty input")
  test("type predicate narrows correctly")
})

describe("PERMISSION_REPLY_RE", () => {
  test("matches 'y abcde'")
  test("matches 'yes abcde'")
  test("matches 'n abcde'")
  test("matches 'no abcde'")
  test("is case-insensitive")
  test("does not match without ID")
})
```

### Mock 需求
`hashToId` 可能需要確認導出狀態
`filterPermissionRelayClients` 需要 mock 客戶端類型
`truncateForPreview` 可能依賴 `jsonStringify`（需 mock `slowOperations`）

---

## 5. `src/services/mcp/__tests__/officialRegistry.test.ts` (~12 tests)

**源文件**: `src/services/mcp/officialRegistry.ts` (73 行)
**目標函數**: `normalizeUrl` (私有), `isOfficialMcpUrl`, `resetOfficialMcpUrlsForTesting`

### 測試用例

```typescript
describe("normalizeUrl", () => {
  // 注意：如果是私有的，通過 isOfficialMcpUrl 間接測試
  test("removes trailing slash")
  test("removes query parameters")
  test("preserves path")
  test("handles URL with port")
  test("handles URL with hash fragment")
})

describe("isOfficialMcpUrl", () => {
  test("returns false when registry not loaded (initial state)")
  test("returns true for URL added to registry")
  test("returns false for non-registered URL")
  test("uses normalized URL for comparison")
})

describe("resetOfficialMcpUrlsForTesting", () => {
  test("clears the cached URLs")
  test("allows fresh start after reset")
})

describe("URL normalization + lookup integration", () => {
  test("URL with trailing slash matches normalized version")
  test("URL with query params matches normalized version")
  test("different URLs do not match")
  test("case sensitivity check")
})
```

### Mock 需求
需 mock `axios`（避免網絡請求）
使用 `resetOfficialMcpUrlsForTesting` 做測試隔離
