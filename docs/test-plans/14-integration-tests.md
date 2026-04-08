# Plan 14 — 集成測試搭建

> 優先級：中 | 新建 ~3 個測試文件 | 預估 ~30 個測試用例

當前 `tests/integration/` 目錄爲空，spec 設計的三個集成測試均未建立。本計劃搭建 mock 基礎設施並實現核心集成測試。

---

## 14.1 搭建 `tests/mocks/` 基礎設施

### 文件結構

```
tests/
├── mocks/
│   ├── api-responses.ts       # Claude API mock 響應
│   ├── file-system.ts         # 臨時檔案系統工具
│   └── fixtures/
│       ├── sample-claudemd.md # CLAUDE.md 樣本
│       └── sample-messages.json # 訊息樣本
├── integration/
│   ├── tool-chain.test.ts
│   ├── context-build.test.ts
│   └── message-pipeline.test.ts
└── helpers/
    └── setup.ts               # 共享 beforeAll/afterAll
```

### `tests/mocks/file-system.ts`

```typescript
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createTempDir(prefix = "claude-test-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return dir;
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function writeTempFile(dir: string, name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf-8");
  return path;
}
```

### `tests/mocks/fixtures/sample-claudemd.md`

```markdown
# Project Instructions

This is a sample CLAUDE.md file for testing.
```

### `tests/mocks/api-responses.ts`

```typescript
export const mockStreamResponse = {
  type: "message_start" as const,
  message: {
    id: "msg_mock_001",
    type: "message" as const,
    role: "assistant",
    content: [],
    model: "claude-sonnet-4-20250514",
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 0 },
  },
};

export const mockTextBlock = {
  type: "content_block_start" as const,
  index: 0,
  content_block: { type: "text" as const, text: "Mock response" },
};

export const mockToolUseBlock = {
  type: "content_block_start" as const,
  index: 1,
  content_block: {
    type: "tool_use" as const,
    id: "toolu_mock_001",
    name: "Read",
    input: { file_path: "/tmp/test.txt" },
  },
};

export const mockEndEvent = {
  type: "message_stop" as const,
};
```

---

## 14.2 `tests/integration/tool-chain.test.ts`

**目標**：驗證 Tool 註冊 → 發現 → 權限檢查鏈路。

### 前置條件

`src/tools.ts` 的 `getAllBaseTools` / `getTools` 導入鏈過重。策略：
- 嘗試直接 import 並 mock 最重依賴
- 若不可行，改爲測試 `src/Tool.ts` 的 `findToolByName` + 手動構造 tool 列表

### 用例

| # | 用例 | 驗證點 |
|---|------|--------|
| 1 | `findToolByName("Bash")` 在已註冊列表中查找 | 返回正確的 tool 定義 |
| 2 | `findToolByName("NonExistent")` | 返回 `undefined` |
| 3 | `findToolByName` 大小寫不敏感 | `"bash"` 也能找到 |
| 4 | `filterToolsByDenyRules` 拒絕特定工具 | 被拒絕工具不在結果中 |
| 5 | `parseToolPreset("default")` 返回已知列表 | 包含核心 tools |
| 6 | `buildTool` 構建的 tool 可被 `findToolByName` 發現 | 端到端驗證 |

> 如果 `getAllBaseTools` 確實不可導入，改用 mock tool list 替代。

---

## 14.3 `tests/integration/context-build.test.ts`

**目標**：驗證系統提示組裝流程（CLAUDE.md 加載 + git status + 日期注入）。

### 前置條件

`src/context.ts` 依賴鏈極重。策略：
- Mock `src/bootstrap/state.ts`（提供 cwd、projectRoot）
- Mock `src/utils/git.ts`（提供 git status）
- 使用真實 `src/utils/claudemd.ts` + 臨時文件

### 用例

| # | 用例 | 驗證點 |
|---|------|--------|
| 1 | 基本 context 構建 | 返回值包含系統提示字符串 |
| 2 | CLAUDE.md 內容出現在 context 中 | `stripHtmlComments` 後的內容被包含 |
| 3 | 多層目錄 CLAUDE.md 合併 | 父目錄 + 子目錄 CLAUDE.md 都被加載 |
| 4 | 無 CLAUDE.md 時不報錯 | context 正常返回，無 crash |
| 5 | git status 爲 null | context 正常構建（測試環境中 git 不可用時） |

> **風險評估**：如果 mock `context.ts` 的依賴鏈成本過高，退化爲測試 `buildEffectiveSystemPrompt`（已在 systemPrompt.test.ts 中完成），記錄爲已知限制。

---

## 14.4 `tests/integration/message-pipeline.test.ts`

**目標**：驗證用戶輸入 → 訊息格式化 → API 請求構建。

### 前置條件

`src/services/api/claude.ts` 構建最終 API 請求。策略：
- Mock Anthropic SDK 的 streaming endpoint
- 驗證請求參數結構

### 用例

| # | 用例 | 驗證點 |
|---|------|--------|
| 1 | 文本訊息格式化 | `createUserMessage` 生成正確 role+content |
| 2 | tool_result 訊息格式化 | 包含 tool_use_id 和 content |
| 3 | 多輪訊息序列化 | messages 數組保持順序 |
| 4 | 系統提示注入到請求 | API 請求的 system 字段非空 |
| 5 | 訊息 normalize 後格式一致 | `normalizeMessages` 輸出結構正確 |

> **現實評估**：訊息格式化的大部分已在 `messages.test.ts` 覆蓋。API 請求構建需要 mock SDK，複雜度高。如果投入產出比低，僅實現用例 1-3 和 5，用例 4 標記爲 stretch goal。

---

## 實施步驟

1. 建立 `tests/mocks/` 目錄和基礎文件
2. 實現 `tool-chain.test.ts`（最低風險，最高價值）
3. 評估 `context-build.test.ts` 可行性，決定是否實施
4. 實現 `message-pipeline.test.ts`（可降級爲單元測試）
5. 更新 `testing-spec.md` 狀態

---

## 驗收標準

- [ ] `tests/mocks/` 基礎設施可用
- [ ] 至少 `tool-chain.test.ts` 實現並通過
- [ ] 集成測試獨立於單元測試執行：`bun test tests/integration/`
- [ ] 所有集成測試使用 `createTempDir` + `cleanupTempDir`，不留檔案系統殘留
- [ ] `bun test` 全部通過
