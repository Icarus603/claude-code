# Phase 19 - Batch 3: Tool 子模組純邏輯

> 預計 ~113 tests / 6 文件 | 採用 `mock.module()` + `await import()` 模式

---

## 1. `src/tools/GrepTool/__tests__/headLimit.test.ts` (~20 tests)

**源文件**: `src/tools/GrepTool/GrepTool.ts` (578 行)
**目標函數**: `applyHeadLimit<T>`, `formatLimitInfo` (非導出，需確認可測性)

### 測試策略
如果函數是檔案內導出的，直接 `await import()` 取得。如果私有，則通過 GrepTool 的輸出間接測試，或提取到獨立文件。

### 測試用例

```typescript
describe("applyHeadLimit", () => {
  test("returns full array when limit is undefined (default 250)")
  test("applies limit correctly: limits to N items")
  test("limit=0 means no limit (returns all)")
  test("applies offset correctly")
  test("offset + limit combined")
  test("offset beyond array length returns empty")
  test("returns appliedLimit when truncation occurred")
  test("returns appliedLimit=undefined when no truncation")
  test("limit larger than array returns all items with appliedLimit=undefined")
  test("empty array returns empty with appliedLimit=undefined")
  test("offset=0 is default")
  test("negative limit behavior")
})

describe("formatLimitInfo", () => {
  test("formats 'limit: N, offset: M' when both present")
  test("formats 'limit: N' when only limit")
  test("formats 'offset: M' when only offset")
  test("returns empty string when both undefined")
  test("handles limit=0 (no limit, should not appear)")
})
```

### Mock 需求
需 mock 重依賴鏈（`log`, `slowOperations` 等），通過 `mock.module()` + `await import()` 只取目標函數

---

## 2. `src/tools/MCPTool/__tests__/classifyForCollapse.test.ts` (~25 tests)

**源文件**: `src/tools/MCPTool/classifyForCollapse.ts` (605 行)
**目標函數**: `classifyMcpToolForCollapse`, `normalize`

### 測試用例

```typescript
describe("normalize", () => {
  test("leaves snake_case unchanged: 'search_issues'")
  test("converts camelCase to snake_case: 'searchIssues' -> 'search_issues'")
  test("converts kebab-case to snake_case: 'search-issues' -> 'search_issues'")
  test("handles mixed: 'searchIssuesByStatus' -> 'search_issues_by_status'")
  test("handles already lowercase single word")
  test("handles empty string")
  test("handles PascalCase: 'SearchIssues' -> 'search_issues'")
})

describe("classifyMcpToolForCollapse", () => {
  // 搜索工具
  test("classifies Slack search_messages as search")
  test("classifies GitHub search_code as search")
  test("classifies Linear search_issues as search")
  test("classifies Datadog search_logs as search")
  test("classifies Notion search as search")

  // 讀取工具
  test("classifies Slack get_message as read")
  test("classifies GitHub get_file_contents as read")
  test("classifies Linear get_issue as read")
  test("classifies Filesystem read_file as read")

  // 雙重分類
  test("some tools are both search and read")
  test("some tools are neither search nor read")

  // 未知工具
  test("unknown tool returns { isSearch: false, isRead: false }")
  test("tool name with camelCase variant still matches")
  test("tool name with kebab-case variant still matches")

  // server name 不影響分類
  test("server name parameter is accepted but unused in current logic")

  // 邊界
  test("empty tool name returns false/false")
  test("case sensitivity check (should match after normalize)")
  test("handles tool names with numbers")
})
```

### Mock 需求
文件自包含（僅內部 Set + normalize 函數），需確認 `normalize` 是否導出

---

## 3. `src/tools/FileReadTool/__tests__/blockedPaths.test.ts` (~18 tests)

**源文件**: `src/tools/FileReadTool/FileReadTool.ts` (1184 行)
**目標函數**: `isBlockedDevicePath`, `getAlternateScreenshotPath`

### 測試用例

```typescript
describe("isBlockedDevicePath", () => {
  // 阻止的設備
  test("blocks /dev/zero")
  test("blocks /dev/random")
  test("blocks /dev/urandom")
  test("blocks /dev/full")
  test("blocks /dev/stdin")
  test("blocks /dev/tty")
  test("blocks /dev/console")
  test("blocks /dev/stdout")
  test("blocks /dev/stderr")
  test("blocks /dev/fd/0")
  test("blocks /dev/fd/1")
  test("blocks /dev/fd/2")

  // 阻止 /proc
  test("blocks /proc/self/fd/0")
  test("blocks /proc/123/fd/2")

  // 允許的路徑
  test("allows /dev/null")
  test("allows regular file paths")
  test("allows /home/user/file.txt")
})

describe("getAlternateScreenshotPath", () => {
  test("returns undefined for path without AM/PM")
  test("returns alternate path for macOS screenshot with regular space before AM")
  test("returns alternate path for macOS screenshot with U+202F before PM")
  test("handles path without time component")
  test("handles multiple AM/PM occurrences")
  test("returns undefined when no space variant difference")
})
```

### Mock 需求
需 mock 重依賴鏈，通過 `await import()` 取得函數

---

## 4. `src/tools/AgentTool/__tests__/agentDisplay.test.ts` (~15 tests)

**源文件**: `src/tools/AgentTool/agentDisplay.ts` (105 行)
**目標函數**: `resolveAgentOverrides`, `compareAgentsByName`

### 測試用例

```typescript
describe("resolveAgentOverrides", () => {
  test("marks no overrides when all agents active")
  test("marks inactive agent as overridden")
  test("overriddenBy shows the overriding agent source")
  test("deduplicates agents by (agentType, source)")
  test("preserves agent definition properties")
  test("handles empty arrays")
  test("handles agent from git worktree (duplicate detection)")
})

describe("compareAgentsByName", () => {
  test("sorts alphabetically ascending")
  test("returns negative when a.name < b.name")
  test("returns positive when a.name > b.name")
  test("returns 0 for same name")
  test("is case-sensitive")
})

describe("AGENT_SOURCE_GROUPS", () => {
  test("contains expected source groups in order")
  test("has unique labels")
})
```

### Mock 需求
需 mock `AgentDefinition`, `AgentSource` 類型依賴

---

## 5. `src/tools/AgentTool/__tests__/agentToolUtils.test.ts` (~20 tests)

**源文件**: `src/tools/AgentTool/agentToolUtils.ts` (688 行)
**目標函數**: `countToolUses`, `getLastToolUseName`, `extractPartialResult`

### 測試用例

```typescript
describe("countToolUses", () => {
  test("counts tool_use blocks in messages")
  test("returns 0 for messages without tool_use")
  test("returns 0 for empty array")
  test("counts multiple tool_use blocks across messages")
  test("counts tool_use in single message with multiple blocks")
})

describe("getLastToolUseName", () => {
  test("returns last tool name from assistant message")
  test("returns undefined for message without tool_use")
  test("returns the last tool when multiple tool_uses present")
  test("handles message with non-array content")
})

describe("extractPartialResult", () => {
  test("extracts text from last assistant message")
  test("returns undefined for messages without assistant content")
  test("handles interrupted agent with partial text")
  test("returns undefined for empty messages")
  test("concatenates multiple text blocks")
  test("skips non-text content blocks")
})
```

### Mock 需求
需 mock 訊息類型依賴

---

## 6. `src/tools/SkillTool/__tests__/skillSafety.test.ts` (~15 tests)

**源文件**: `src/tools/SkillTool/SkillTool.ts` (1110 行)
**目標函數**: `skillHasOnlySafeProperties`, `extractUrlScheme`

### 測試用例

```typescript
describe("skillHasOnlySafeProperties", () => {
  test("returns true for command with only safe properties")
  test("returns true for command with undefined extra properties")
  test("returns false for command with unsafe meaningful property")
  test("returns true for command with null extra properties")
  test("returns true for command with empty array extra property")
  test("returns true for command with empty object extra property")
  test("returns false for command with non-empty unsafe array")
  test("returns false for command with non-empty unsafe object")
  test("returns true for empty command object")
})

describe("extractUrlScheme", () => {
  test("extracts 'gs' from 'gs://bucket/path'")
  test("extracts 'https' from 'https://example.com'")
  test("extracts 'http' from 'http://example.com'")
  test("extracts 's3' from 's3://bucket/path'")
  test("defaults to 'gs' for unknown scheme")
  test("defaults to 'gs' for path without scheme")
  test("defaults to 'gs' for empty string")
})
```

### Mock 需求
需 mock 重依賴鏈，`await import()` 取得函數
