# 訊息處理測試計劃

## 概述

訊息處理系統負責訊息的建立、查詢、規範化和文本提取。覆蓋訊息類型定義、訊息工廠函數、訊息過濾/查詢工具和 API 規範化管線。

## 被測文件

| 文件 | 關鍵導出 |
|------|----------|
| `src/types/message.ts` | `MessageType`, `Message`, `AssistantMessage`, `UserMessage`, `SystemMessage` 等類型 |
| `src/utils/messages.ts` | 訊息建立、查詢、規範化、文本提取等函數（~3100 行） |
| `src/utils/messages/mappers.ts` | 訊息映射工具 |

---

## 測試用例

### src/utils/messages.ts — 訊息建立

#### describe('createAssistantMessage')

- test('creates message with type "assistant"') — type 字段正確
- test('creates message with role "assistant"') — role 正確
- test('creates message with empty content array') — 預設 content 爲空
- test('generates unique uuid') — 每次呼叫 uuid 不同
- test('includes costUsd as 0')

#### describe('createUserMessage')

- test('creates message with type "user"') — type 字段正確
- test('creates message with provided content') — content 正確傳入
- test('generates unique uuid')

#### describe('createSystemMessage')

- test('creates system message with correct type')
- test('includes message content')

#### describe('createProgressMessage')

- test('creates progress message with data')
- test('has correct type "progress"')

---

### src/utils/messages.ts — 訊息查詢

#### describe('getLastAssistantMessage')

- test('returns last assistant message from array') — 多條訊息中返回最後一條 assistant
- test('returns undefined for empty array')
- test('returns undefined when no assistant messages exist')

#### describe('hasToolCallsInLastAssistantTurn')

- test('returns true when last assistant has tool_use content') — content 含 tool_use block
- test('returns false when last assistant has only text')
- test('returns false for empty messages')

#### describe('isSyntheticMessage')

- test('identifies interrupt message as synthetic') — INTERRUPT_MESSAGE 標記
- test('identifies cancel message as synthetic')
- test('returns false for normal user messages')

#### describe('isNotEmptyMessage')

- test('returns true for message with content')
- test('returns false for message with empty content array')
- test('returns false for message with empty text content')

---

### src/utils/messages.ts — 文本提取

#### describe('getAssistantMessageText')

- test('extracts text from text blocks') — content 含 `{ type: 'text', text: 'hello' }` 時提取
- test('returns empty string for non-text content') — 僅含 tool_use 時返回空
- test('concatenates multiple text blocks')

#### describe('getUserMessageText')

- test('extracts text from string content') — content 爲純字符串
- test('extracts text from content array') — content 爲數組時提取 text 塊
- test('handles empty content')

#### describe('extractTextContent')

- test('extracts text items from mixed content') — 過濾出 type: 'text' 的項
- test('returns empty array for all non-text content')

---

### src/utils/messages.ts — 規範化

#### describe('normalizeMessages')

- test('converts raw messages to normalized format') — 訊息數組規範化
- test('handles empty array') — `[]` → `[]`
- test('preserves message order')
- test('handles mixed message types')

#### describe('normalizeMessagesForAPI')

- test('filters out system messages') — 系統訊息不發送給 API
- test('filters out progress messages')
- test('filters out attachment messages')
- test('preserves user and assistant messages')
- test('reorders tool results to match API expectations')
- test('handles empty array')

---

### src/utils/messages.ts — 合併

#### describe('mergeUserMessages')

- test('merges consecutive user messages') — 相鄰用戶訊息合併
- test('does not merge non-consecutive user messages')
- test('preserves assistant messages between user messages')

#### describe('mergeAssistantMessages')

- test('merges consecutive assistant messages')
- test('combines content arrays')

---

### src/utils/messages.ts — 輔助函數

#### describe('buildMessageLookups')

- test('builds index by message uuid') — 按 uuid 建立查找表
- test('returns empty lookups for empty messages')
- test('handles duplicate uuids gracefully')

---

## Mock 需求

| 依賴 | Mock 方式 | 說明 |
|------|-----------|------|
| `crypto.randomUUID` | `mock` 或 spy | 訊息建立中的 uuid 生成 |
| Message 對象 | 手動構造 | 建立符合類型的 mock 訊息對象 |

### Mock 訊息工廠（放在 `tests/mocks/messages.ts`）

```typescript
// 通用 mock 訊息構造器
export function mockAssistantMessage(overrides?: Partial<AssistantMessage>): AssistantMessage
export function mockUserMessage(content: string, overrides?: Partial<UserMessage>): UserMessage
export function mockSystemMessage(overrides?: Partial<SystemMessage>): SystemMessage
export function mockToolUseBlock(name: string, input: unknown): ToolUseBlock
export function mockToolResultMessage(toolUseId: string, content: string): UserMessage
```

## 集成測試場景

### describe('Message pipeline')

- test('create → normalize → API format produces valid request') — 建立訊息 → normalizeMessagesForAPI → 驗證輸出結構
- test('tool use and tool result pairing is preserved through normalization')
- test('merge + normalize handles conversation with interruptions')
