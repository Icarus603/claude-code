# 第二階段 Q&A

## Q1：query.ts 的流式訊息處理具體是怎樣的？

**核心問題**：`deps.callModel()` yield 出的每一條訊息，在 `queryLoop()` 的 `for await` 循環體（L659-866）中具體經歷了什麼處理？

### 場景

用戶說：**"幫我看看 package.json 的內容"**

模型回覆：一段文字 "我來讀取文件。" + 一個 Read 工具呼叫。

### callModel yield 的完整訊息序列

claude.ts 的 `queryModel()` 會 yield 兩種類型的訊息：

| 類型標記 | 含義 | 產出時機 |
|---------|------|---------|
| `stream_event` | 原始 SSE 事件包裝 | 每個 SSE 事件都產出一條 |
| `assistant` | 完整的 AssistantMessage | 僅在 `content_block_stop` 時產出 |

本例中 callModel 依次 yield **共 13 條訊息**：

```
#1  { type: 'stream_event', event: { type: 'message_start', ... }, ttftMs: 342 }
#2  { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } }
#3  { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '我來' } } }
#4  { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '讀取文件。' } } }
#5  { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }
#6  { type: 'assistant', uuid: 'uuid-1', message: { content: [{ type: 'text', text: '我來讀取文件。' }], stop_reason: null } }
#7  { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_001', name: 'Read' } } }
#8  { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":' } } }
#9  { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"/path/package.json"}' } } }
#10 { type: 'stream_event', event: { type: 'content_block_stop', index: 1 } }
#11 { type: 'assistant', uuid: 'uuid-2', message: { content: [{ type: 'tool_use', id: 'toolu_001', name: 'Read', input: { file_path: '/path/package.json' } }], stop_reason: null } }
#12 { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 87 } } }
#13 { type: 'stream_event', event: { type: 'message_stop' } }
```

注意 `#6` 和 `#11` 是 **assistant 類型**（content_block_stop 時由 claude.ts 組裝），其餘全是 **stream_event 類型**。

### 循環體結構

循環體在 L708-866，結構如下：

```
for await (const message of deps.callModel({...})) {   // L659
    // A. 降級檢查 (L712)
    // B. backfill (L747-789)
    // C. withheld 檢查 (L801-824)
    // D. yield (L825-827)
    // E. assistant 收集 + addTool (L828-848)
    // F. getCompletedResults (L850-865)
}
```

### 逐條走循環體

#### #1 stream_event (message_start)

```
A. L712: streamingFallbackOccured = false → 跳過

B. L748: message.type === 'assistant'?
   → 'stream_event' !== 'assistant' → 跳過整個 backfill 塊

C. L801-824: withheld 檢查
   → 不是 assistant 類型，各項檢查均爲 false → withheld = false

D. L825: yield message  ✅ → 透傳給 REPL（REPL 記錄 ttftMs）

E. L828: message.type === 'assistant'? → 否 → 跳過

F. L850-854: streamingToolExecutor.getCompletedResults()
   → tools 數組爲空 → 無結果
```

**淨效果**：`yield` 透傳。

---

#### #2 stream_event (content_block_start, type: text)

```
A-C. 同 #1
D.   yield message  ✅ → REPL 設置 spinner 爲 "Responding..."
E-F. 同 #1
```

**淨效果**：`yield` 透傳。

---

#### #3 stream_event (text_delta: "我來")

```
A-C. 同 #1
D.   yield message  ✅ → REPL 追加 streamingText += "我來"（打字機效果）
E-F. 同 #1
```

**淨效果**：`yield` 透傳。

---

#### #4 stream_event (text_delta: "讀取文件。")

```
同 #3
D. yield message  ✅ → REPL streamingText += "讀取文件。"
```

**淨效果**：`yield` 透傳。

---

#### #5 stream_event (content_block_stop, index:0)

```
同 #2
D. yield message  ✅ → REPL 無特殊操作（真正的 AssistantMessage 在下一條 #6）
```

**淨效果**：`yield` 透傳。

---

#### #6 assistant (text block 完整訊息) ★

第一條 `type: 'assistant'` 的訊息，走**完全不同的路徑**：

```
A. L712: streamingFallbackOccured = false → 跳過

B. L748: message.type === 'assistant'? → ✅ 進入 backfill
   L750: contentArr = [{ type: 'text', text: '我來讀取文件。' }]
   L752: for i=0: block.type === 'text'
   L754: block.type === 'tool_use'? → 否 → 跳過
   L783: clonedContent 爲 undefined → yieldMessage = message（原樣不變）

C. L801: let withheld = false
   L802: feature('CONTEXT_COLLAPSE') → false → 跳過
   L813: reactiveCompact?.isWithheldPromptTooLong(message) → 否 → false
   L822: isWithheldMaxOutputTokens(message)
         → message.message.stop_reason === null → false
   → withheld = false

D. L825: yield message  ✅ → REPL 清除 streamingText，添加完整 text 訊息到列表

E. L828: message.type === 'assistant'? → ✅
   L830: assistantMessages.push(message)
         → assistantMessages = [uuid-1(text)]

   L832-834: msgToolUseBlocks = content.filter(type === 'tool_use')
             → []（這是 text block，沒有 tool_use）

   L835: length > 0? → 否 → 不設 needsFollowUp
   L844: msgToolUseBlocks 爲空 → 不呼叫 addTool

F. L854: getCompletedResults() → 空
```

**淨效果**：`yield` 訊息 + `assistantMessages` 增加一條。`needsFollowUp` 仍爲 `false`。

---

#### #7 stream_event (content_block_start, tool_use: Read)

```
A-C. 同 stream_event 通用路徑
D.   yield message  ✅ → REPL 設置 spinner 爲 "tool-input"，添加 streamingToolUse
E.   不是 assistant → 跳過
F.   getCompletedResults() → 空
```

---

#### #8 stream_event (input_json_delta: '{"file_path":')

```
D. yield message  ✅ → REPL 追加工具輸入 JSON 碎片
F. getCompletedResults() → 空
```

---

#### #9 stream_event (input_json_delta: '"/path/package.json"}')

```
D. yield message  ✅
F. getCompletedResults() → 空
```

---

#### #10 stream_event (content_block_stop, index:1)

```
D. yield message  ✅
F. getCompletedResults() → 空
```

---

#### #11 assistant (tool_use block 完整訊息) ★★

這條是**最關鍵的**——觸發工具執行：

```
A. L712: streamingFallbackOccured = false → 跳過

B. L748: message.type === 'assistant'? → ✅ 進入 backfill
   L750: contentArr = [{ type: 'tool_use', id: 'toolu_001', name: 'Read',
                          input: { file_path: '/path/package.json' } }]
   L752: for i=0:
   L754: block.type === 'tool_use'? → ✅
   L756: typeof block.input === 'object' && !== null? → ✅
   L759: tool = findToolByName(tools, 'Read') → Read 工具定義
   L763: tool.backfillObservableInput 存在? → 假設存在
   L764-766: inputCopy = { file_path: '/path/package.json' }
             tool.backfillObservableInput(inputCopy)
             → 可能添加 absolutePath 字段
   L773-776: addedFields? → 假設有新增字段
             clonedContent = [...contentArr]
             clonedContent[0] = { ...block, input: inputCopy }
   L783-788: yieldMessage = {
               ...message,                 // uuid, type, timestamp 不變
               message: {
                 ...message.message,        // stop_reason, usage 不變
                 content: clonedContent      // ★ 替換爲帶 absolutePath 的副本
               }
             }
             // ★ 原始 message 保持不變（回傳 API 保證快取一致）

C. L801-824: withheld 檢查 → 全部 false → withheld = false

D. L825: yield yieldMessage  ✅
         → yield 的是克隆版（帶 backfill 字段），給 REPL 和 SDK 用
         → 原始 message 下面存進 assistantMessages，回傳 API 保證快取一致

E. L828: message.type === 'assistant'? → ✅
   L830: assistantMessages.push(message)   // ★ push 原始 message，不是 yieldMessage
         → assistantMessages = [uuid-1(text), uuid-2(tool_use)]

   L832-834: msgToolUseBlocks = content.filter(type === 'tool_use')
             → [{ type: 'tool_use', id: 'toolu_001', name: 'Read', input: {...} }]

   L835: length > 0? → ✅
   L836: toolUseBlocks.push(...msgToolUseBlocks)
         → toolUseBlocks = [Read_block]
   L837: needsFollowUp = true          // ★★★ 決定 while(true) 不會終止

   L840-842: streamingToolExecutor 存在 ✓ && !aborted ✓
   L844-846: for (const toolBlock of msgToolUseBlocks):
             streamingToolExecutor.addTool(Read_block, uuid-2訊息)
             // ★★★ 工具開始執行！
             // → StreamingToolExecutor 內部：
             //   isConcurrencySafe = true（Read 是安全的）
             //   queued → processQueue() → canExecuteTool() → true
             //   → executeTool() → runToolUse() → 後臺異步讀文件

F. L850-854: getCompletedResults()
   → Read 剛開始執行，status = 'executing' → 無完成結果
```

**淨效果**：
- `yield` 克隆訊息（帶 backfill 字段）
- `assistantMessages` push 原始訊息
- `needsFollowUp = true`
- **Read 工具在後臺異步開始執行**

---

#### #12 stream_event (message_delta, stop_reason: 'tool_use')

```
A-C. 同 stream_event 通用路徑
D.   yield message  ✅

E.   不是 assistant → 跳過

F. L854: getCompletedResults()
   → ★ 此時 Read 可能已經完成了!（讀文件通常 <1ms）
   → 如果完成: status = 'completed', results 有值
     L428(StreamingToolExecutor): tool.status = 'yielded'
     L431-432: yield { message: UserMsg(tool_result) }
   → 回到 query.ts:
     L855: result.message 存在
     L856: yield result.message  ✅ → REPL 顯示工具結果
     L857-862: toolResults.push(normalizeMessagesForAPI([result.message])...)
               → toolResults = [Read 的 tool_result]
```

**淨效果**：`yield` stream_event + **可能 yield 工具結果**（如果工具已完成）。

---

#### #13 stream_event (message_stop)

```
D. yield message  ✅
F. getCompletedResults()
   → 如果 Read 在 #12 已被收割 → 空
   → 如果 Read 此時才完成 → yield 工具結果（同 #12 的 F 邏輯）
```

---

### for await 循環退出後

```
L1018: aborted? → false → 跳過

L1065: if (!needsFollowUp)
       → needsFollowUp = true → 不進入 → 跳過終止邏輯

L1383: toolUpdates = streamingToolExecutor.getRemainingResults()
       → 如果 Read 已在 #12/#13 被收割 → 立即返回空
       → 如果 Read 還沒完成 → 阻塞等待 → 完成後 yield 結果

L1387-1404: for await (const update of toolUpdates) {
              yield update.message        → REPL 顯示
              toolResults.push(...)        → 收集
            }

L1718-1730: 構建 next State:
  state = {
    messages: [
      ...messagesForQuery,     // [UserMessage("幫我看看...")]
      ...assistantMessages,    // [AssistantMsg(text), AssistantMsg(tool_use)]
      ...toolResults,          // [UserMsg(tool_result)]
    ],
    turnCount: 1,
    transition: { reason: 'next_turn' },
  }
  → continue → while(true) 第 2 次迭代 → 帶着工具結果再次調 API
```

### 循環體判定樹總結

```
for await (const message of deps.callModel(...)) {
    │
    ├─ message.type === 'stream_event'?
    │   │
    │   └─ YES → 幾乎零操作
    │        ├─ yield message（透傳給 REPL 做實時 UI）
    │        └─ getCompletedResults()（順便檢查有沒有完成的工具）
    │
    └─ message.type === 'assistant'?
        │
        ├─ B. backfill: 有 tool_use + backfillObservableInput?
        │   ├─ YES → 克隆訊息，yield 克隆版（原始訊息保留給 API）
        │   └─ NO  → yield 原始訊息
        │
        ├─ C. withheld: prompt_too_long / max_output_tokens?
        │   ├─ YES → 不 yield（暫扣，等後面恢復邏輯處理）
        │   └─ NO  → yield
        │
        ├─ E. assistantMessages.push(原始 message)
        │
        ├─ E. 有 tool_use block?
        │   ├─ YES → toolUseBlocks.push()
        │   │         + needsFollowUp = true
        │   │         + streamingToolExecutor.addTool() → ★ 立即開始執行工具
        │   └─ NO  → 什麼都不做
        │
        └─ F. getCompletedResults() → 收割已完成的工具結果
}
```

**一句話總結**：stream_event 透傳不處理；assistant 訊息纔是"真正的貨"——收集起來、判斷要不要暫扣、有工具就立即開始執行、順便收割已完成的工具結果。