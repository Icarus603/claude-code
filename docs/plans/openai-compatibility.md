# OpenAI 協議相容層

## 概述

claude-code 支援通過 OpenAI Chat Completions API（`/v1/chat/completions`）相容任意 OpenAI 協議端點，包括 Ollama、DeepSeek、vLLM、One API、LiteLLM 等。

核心策略爲**流適配器模式**：在 `queryModel()` 中插入提前返回分支，將 Anthropic 格式請求轉爲 OpenAI 格式，呼叫 OpenAI SDK，再將 SSE 流轉換回 `BetaRawMessageStreamEvent` 格式。下游程式碼（流處理循環、query.ts、QueryEngine.ts、REPL）**完全不改**。

## 環境變量

| 變量 | 必需 | 說明 |
|---|---|---|
| `CLAUDE_CODE_USE_OPENAI` | 是 | 設爲 `1` 啓用 OpenAI 後端 |
| `OPENAI_API_KEY` | 是 | API key（Ollama 等可設爲任意值） |
| `OPENAI_BASE_URL` | 推薦 | 端點 URL（如 `http://localhost:11434/v1`） |
| `OPENAI_MODEL` | 可選 | 覆蓋所有請求的模型名（跳過映射） |
| `OPENAI_DEFAULT_OPUS_MODEL` | 可選 | 覆蓋 opus 家族對應的模型（如 `o3`, `o3-mini`, `o1-pro`） |
| `OPENAI_DEFAULT_SONNET_MODEL` | 可選 | 覆蓋 sonnet 家族對應的模型（如 `gpt-4o`, `gpt-4.1`） |
| `OPENAI_DEFAULT_HAIKU_MODEL` | 可選 | 覆蓋 haiku 家族對應的模型（如 `gpt-4o-mini`, `gpt-4.0-mini`） |
| `OPENAI_ORG_ID` | 可選 | Organization ID |
| `OPENAI_PROJECT_ID` | 可選 | Project ID |

### 使用示例

```bash
# Ollama
CLAUDE_CODE_USE_OPENAI=1 \
OPENAI_API_KEY=ollama \
OPENAI_BASE_URL=http://localhost:11434/v1 \
OPENAI_MODEL=qwen2.5-coder-32b \
bun run dev

# DeepSeek（自動支援 Thinking）
CLAUDE_CODE_USE_OPENAI=1 \
OPENAI_API_KEY=sk-xxx \
OPENAI_BASE_URL=https://api.deepseek.com/v1 \
OPENAI_MODEL=deepseek-chat \
bun run dev

# vLLM
CLAUDE_CODE_USE_OPENAI=1 \
OPENAI_API_KEY=token-abc123 \
OPENAI_BASE_URL=http://localhost:8000/v1 \
OPENAI_MODEL=Qwen/Qwen2.5-Coder-32B-Instruct \
bun run dev

# One API / LiteLLM
CLAUDE_CODE_USE_OPENAI=1 \
OPENAI_API_KEY=sk-your-key \
OPENAI_BASE_URL=https://your-one-api.example.com/v1 \
OPENAI_MODEL=gpt-4o \
bun run dev

# 自定義模型映射（使用家族變量）
CLAUDE_CODE_USE_OPENAI=1 \
OPENAI_API_KEY=sk-xxx \
OPENAI_BASE_URL=https://my-gateway.example.com/v1 \
OPENAI_DEFAULT_SONNET_MODEL="gpt-4o-2024-11-20" \
OPENAI_DEFAULT_HAIKU_MODEL="gpt-4o-mini" \
bun run dev
```

## 架構

### 請求流程

```
queryModel() [claude.ts]
  ├── 共享預處理（訊息歸一化、工具過濾、媒體裁剪）
  └── if (getAPIProvider() === 'openai')
      └── queryModelOpenAI() [openai/index.ts]
          ├── resolveOpenAIModel()          → 解析模型名
          ├── normalizeMessagesForAPI()      → 共享訊息預處理
          ├── toolToAPISchema()              → 構建工具 schema
          ├── anthropicMessagesToOpenAI()    → 訊息格式轉換
          ├── anthropicToolsToOpenAI()       → 工具格式轉換
          ├── openai.chat.completions.create({ stream: true })
          └── adaptOpenAIStreamToAnthropic() → 流格式轉換
              ├── delta.reasoning_content    → thinking 塊
              ├── delta.content             → text 塊
              ├── delta.tool_calls          → tool_use 塊
              ├── usage.cached_tokens       → cache_read_input_tokens
              └── yield BetaRawMessageStreamEvent
```

### 模型名解析優先級

`resolveOpenAIModel()` 的解析順序：

1. `OPENAI_MODEL` 環境變量 → 直接使用，覆蓋所有
2. `OPENAI_DEFAULT_{FAMILY}_MODEL` 變量（如 `OPENAI_DEFAULT_SONNET_MODEL`）→ 按模型家族覆蓋
3. `ANTHROPIC_DEFAULT_{FAMILY}_MODEL` 變量（向後相容）
4. 內置預設映射（見下表）
5. 以上都不匹配 → 原名透傳

### 內置模型映射

| Anthropic 模型 | OpenAI 映射 |
|---|---|
| `claude-sonnet-4-6` | `gpt-4o` |
| `claude-sonnet-4-5-20250929` | `gpt-4o` |
| `claude-sonnet-4-20250514` | `gpt-4o` |
| `claude-3-7-sonnet-20250219` | `gpt-4o` |
| `claude-3-5-sonnet-20241022` | `gpt-4o` |
| `claude-opus-4-6` | `o3` |
| `claude-opus-4-5-20251101` | `o3` |
| `claude-opus-4-1-20250805` | `o3` |
| `claude-opus-4-20250514` | `o3` |
| `claude-haiku-4-5-20251001` | `gpt-4o-mini` |
| `claude-3-5-haiku-20241022` | `gpt-4o-mini` |

同時會自動剝離 `[1m]` 後綴（Claude 特有的 modifier）。

## 文件結構

### 新增文件

```
src/services/api/openai/
├── client.ts              # OpenAI SDK 客戶端工廠（~50 行）
├── convertMessages.ts     # Anthropic → OpenAI 訊息格式轉換（~190 行）
├── convertTools.ts        # Anthropic → OpenAI 工具格式轉換（~70 行）
├── streamAdapter.ts       # SSE 流轉換核心，含 thinking + caching（~270 行）
├── modelMapping.ts        # 模型名解析（~60 行）
├── index.ts               # 公共入口 queryModelOpenAI()（~110 行）
└── __tests__/
    ├── convertMessages.test.ts   # 10 個測試
    ├── convertTools.test.ts      # 7 個測試
    ├── modelMapping.test.ts      # 6 個測試
    └── streamAdapter.test.ts     # 14 個測試（含 thinking + caching）
```

### 修改文件

| 文件 | 改動 |
|---|---|
| `src/utils/model/providers.ts` | 添加 `'openai'` provider 類型 + `CLAUDE_CODE_USE_OPENAI` 檢查（最高優先級） |
| `src/utils/model/configs.ts` | 每個 ModelConfig 添加 `openai` 鍵 |
| `src/services/api/claude.ts` | 在 `stripExcessMediaItems()` 後插入 OpenAI 提前返回分支（~8 行） |
| `package.json` | 添加 `"openai": "^4.73.0"` 依賴 |

## 訊息轉換規則

### Anthropic → OpenAI

| Anthropic | OpenAI |
|---|---|
| `system` prompt（`string[]`） | `role: "system"` 訊息（`\n\n` 拼接） |
| `user` + `text` 塊 | `role: "user"` 訊息 |
| `assistant` + `text` 塊 | `role: "assistant"` + `content` |
| `assistant` + `tool_use` 塊 | `role: "assistant"` + `tool_calls[]` |
| `user` + `tool_result` 塊 | `role: "tool"` + `tool_call_id` |
| `thinking` 塊 | 靜默丟棄（請求側） |

### 工具轉換

| Anthropic | OpenAI |
|---|---|
| `{ name, description, input_schema }` | `{ type: "function", function: { name, description, parameters } }` |
| `cache_control`, `defer_loading` 等字段 | 剝離 |
| `tool_choice: { type: "auto" }` | `"auto"` |
| `tool_choice: { type: "any" }` | `"required"` |
| `tool_choice: { type: "tool", name }` | `{ type: "function", function: { name } }` |

### 訊息轉換示例

```
Anthropic:                              OpenAI:
[
  system: ["You are helpful."],         [
                                          { role: "system",
  { role: "user",                          content: "You are helpful." },
    content: [                            { role: "user",
      { type: "text", text: "Run ls" }      content: "Run ls"
    ]                                     },
  },                                      { role: "assistant",
  { role: "assistant",                     content: "I'll check.",
    content: [                            tool_calls: [{
      { type: "text", text: "I'll check."},  id: "tu_123",
      { type: "tool_use",                    type: "function",
        id: "tu_123", name: "bash",          function: {
        input: { command: "ls" } }             name: "bash",
    ]                                           arguments: '{"command":"ls"}'
  },                                      }] }
  { role: "user",                        { role: "tool",
    content: [                              tool_call_id: "tu_123",
      { type: "tool_result",                content: "file1\nfile2"
        tool_use_id: "tu_123",            }
        content: "file1\nfile2"          ]
    ]
  }
]
```

## 流轉換規則

### SSE Chunk → Anthropic Event 映射

| OpenAI Chunk | Anthropic Event |
|---|---|
| 首個 chunk | `message_start`（含 usage） |
| `delta.reasoning_content` | `content_block_start(thinking)` + `thinking_delta` |
| `delta.content` | `content_block_start(text)` + `text_delta` |
| `delta.tool_calls` | `content_block_start(tool_use)` + `input_json_delta` |
| `finish_reason: "stop"` | `message_delta(stop_reason: "end_turn")` |
| `finish_reason: "tool_calls"` | `message_delta(stop_reason: "tool_use")` |
| `finish_reason: "length"` | `message_delta(stop_reason: "max_tokens")` |

### 塊順序

當模型返回 `reasoning_content` 時（如 DeepSeek），塊順序與 Anthropic 一致：

```
thinking block (index 0)  ← delta.reasoning_content
text block    (index 1)   ← delta.content
```

或：

```
thinking block (index 0)  ← delta.reasoning_content
tool_use block (index 1)  ← delta.tool_calls
```

無 `reasoning_content` 時：

```
text block    (index 0)   ← delta.content
tool_use block (index 1)  ← delta.tool_calls（如果有）
```

### finish_reason 映射

| OpenAI | Anthropic |
|---|---|
| `stop` | `end_turn` |
| `tool_calls` | `tool_use` |
| `length` | `max_tokens` |
| `content_filter` | `end_turn` |

### 事件序列示例

**純文本響應**：
```
OpenAI chunks:
  delta.content = "Hello"
  delta.content = " world"
  finish_reason = "stop"

→ Anthropic events:
  message_start       { message: { id, role: 'assistant', usage: {...} } }
  content_block_start { index: 0, content_block: { type: 'text' } }
  content_block_delta { index: 0, delta: { type: 'text_delta', text: 'Hello' } }
  content_block_delta { index: 0, delta: { type: 'text_delta', text: ' world' } }
  content_block_stop  { index: 0 }
  message_delta       { delta: { stop_reason: 'end_turn' } }
  message_stop
```

**Thinking + 文本（DeepSeek 風格）**：
```
OpenAI chunks:
  delta.reasoning_content = "Let me think..."
  delta.reasoning_content = " step by step."
  delta.content = "The answer is 42."
  finish_reason = "stop"

→ Anthropic events:
  message_start       { ... }
  content_block_start { index: 0, content_block: { type: 'thinking', signature: '' } }
  content_block_delta { index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think...' } }
  content_block_delta { index: 0, delta: { type: 'thinking_delta', thinking: ' step by step.' } }
  content_block_stop  { index: 0 }
  content_block_start { index: 1, content_block: { type: 'text' } }
  content_block_delta { index: 1, delta: { type: 'text_delta', text: 'The answer is 42.' } }
  content_block_stop  { index: 1 }
  message_delta       { delta: { stop_reason: 'end_turn' } }
  message_stop
```

**工具呼叫**：
```
OpenAI chunks:
  delta.tool_calls[0] = { id: 'call_xxx', function: { name: 'bash', arguments: '' } }
  delta.tool_calls[0].function.arguments = '{"comm'
  delta.tool_calls[0].function.arguments = 'and":"ls"}'
  finish_reason = "tool_calls"

→ Anthropic events:
  message_start       { ... }
  content_block_start { index: 0, content_block: { type: 'tool_use', id: 'call_xxx', name: 'bash' } }
  content_block_delta { index: 0, delta: { type: 'input_json_delta', partial_json: '{"comm' } }
  content_block_delta { index: 0, delta: { type: 'input_json_delta', partial_json: 'and":"ls"}' } }
  content_block_stop  { index: 0 }
  message_delta       { delta: { stop_reason: 'tool_use' } }
  message_stop
```

## 功能支援

### Thinking（思維鏈）

**請求側**：不需要顯式設定。支援思維鏈的模型（DeepSeek 等）會自動返回 `delta.reasoning_content`。

**響應側**：`delta.reasoning_content` 被轉換爲 Anthropic `thinking` content block：

```ts
// content_block_start
{ type: 'content_block_start', index: 0,
  content_block: { type: 'thinking', thinking: '', signature: '' } }

// content_block_delta
{ type: 'content_block_delta', index: 0,
  delta: { type: 'thinking_delta', thinking: 'Let me analyze...' } }
```

thinking block 在 text/tool_use block 之前自動關閉，保持 Anthropic 的塊順序。

### Prompt Caching

**請求側**：OpenAI 端點使用自動快取，無需顯式設置 `cache_control`。

**響應側**：OpenAI 的 `usage.prompt_tokens_details.cached_tokens` 被映射到 Anthropic 的 `cache_read_input_tokens`：

```
OpenAI:   usage.prompt_tokens_details.cached_tokens = 800
     ↓
Anthropic: message_start.message.usage.cache_read_input_tokens = 800
```

在 `message_start` 的 usage 中報告快取命中量。

### 工具呼叫（Tool Use）

完整支援 OpenAI function calling 格式。所有本地工具（Bash、FileEdit、Grep、Glob、Agent 等）透明工作——它們通過 JSON 輸入輸出通信，格式無關。

工具參數以 `input_json_delta` 形式流式傳輸，由下游程式碼拼接解析。

### 不支援的功能

| 功能 | 策略 |
|---|---|
| Beta Headers | 不發送 |
| Server Tools (advisor) | 不發送 |
| Structured Output | 不發送 |
| Fast Mode / Effort | 不發送 |
| Tool Search / defer_loading | 不啓用，所有工具直接發送 |
| Anthropic Signature | thinking block 的 `signature` 字段爲空字符串 |
| cache_creation_input_tokens | 始終爲 0（OpenAI 不區分建立/讀取） |

## 測試

```bash
# 執行所有 OpenAI 適配層測試
bun test src/services/api/openai/__tests__/

# 單獨執行
bun test src/services/api/openai/__tests__/streamAdapter.test.ts     # 14 tests（含 thinking + caching）
bun test src/services/api/openai/__tests__/convertMessages.test.ts   # 10 tests
bun test src/services/api/openai/__tests__/convertTools.test.ts      # 7 tests
bun test src/services/api/openai/__tests__/modelMapping.test.ts      # 6 tests
```

當前測試覆蓋：**39 tests / 73 assertions / 0 fail**。

### 測試覆蓋矩陣

| 功能 | convertMessages | convertTools | streamAdapter | modelMapping |
|---|---|---|---|---|
| 文本訊息轉換 | ✅ | | | |
| tool_use 轉換 | ✅ | | | |
| tool_result 轉換 | ✅ | | | |
| thinking 剝離 | ✅ | | | |
| 完整對話流程 | ✅ | | | |
| 工具 schema 轉換 | | ✅ | | |
| tool_choice 映射 | | ✅ | | |
| 純文本流 | | | ✅ | |
| 工具呼叫流 | | | ✅ | |
| 混合文本+工具 | | | ✅ | |
| finish_reason 映射 | | | ✅ | |
| thinking 流 | | | ✅ | |
| thinking+text 切換 | | | ✅ | |
| thinking+tool_use 切換 | | | ✅ | |
| 塊索引正確性 | | | ✅ | |
| cached_tokens 映射 | | | ✅ | |
| OPENAI_MODEL 覆蓋 | | | | ✅ |
| 預設模型映射 | | | | ✅ |
| 未知模型透傳 | | | | ✅ |
| [1m] 後綴剝離 | | | | ✅ |

## 端到端驗證

```bash
# 1. 安裝依賴
bun install

# 2. 執行單元測試
bun test src/services/api/openai/__tests__/

# 3. 連接實際端點（以 Ollama 爲例）
CLAUDE_CODE_USE_OPENAI=1 \
OPENAI_API_KEY=ollama \
OPENAI_BASE_URL=http://localhost:11434/v1 \
OPENAI_MODEL=qwen2.5-coder-32b \
bun run dev

# 4. 連接 DeepSeek（測試 thinking 支援）
CLAUDE_CODE_USE_OPENAI=1 \
OPENAI_API_KEY=sk-xxx \
OPENAI_BASE_URL=https://api.deepseek.com/v1 \
OPENAI_MODEL=deepseek-reasoner \
bun run dev

# 5. 確認現有測試不受影響
bun test  # 無 CLAUDE_CODE_USE_OPENAI 時走原有路徑
```

## 程式碼統計

| 類別 | 行數 |
|---|---|
| 新增源碼 | ~620 行 |
| 新增測試 | ~450 行 |
| 改動現有程式碼 | ~25 行 |
| **總計** | **~1100 行** |
