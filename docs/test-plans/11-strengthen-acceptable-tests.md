# Plan 11 — 加強 ACCEPTABLE 評分測試

> 優先級：中 | ~15 個文件 | 預估新增 ~80 個測試用例

本計劃對 ACCEPTABLE 評分檔案中的具體缺陷進行定向加強。每個條目只列出需要改動的部分，不做全量重寫。

---

## 11.1 `src/utils/__tests__/diff.test.ts`

| 改動 | 當前 | 改爲 |
|------|------|------|
| `getPatchFromContents` 斷言 | `hunks.length > 0` | 驗證具體 `+`/`-` 行內容 |
| `$` 字符轉義 | 未測試 | 新增含 `$` 的內容測試 |
| `ignoreWhitespace` 選項 | 未測試 | 新增 `ignoreWhitespace: true` 用例 |
| 刪除全部內容 | 未測試 | `newContent: ""` |
| 多 hunk 偏移 | `adjustHunkLineNumbers` 僅單 hunk | 新增多 hunk 同數組測試 |

---

## 11.2 `src/utils/__tests__/path.test.ts`

當前僅覆蓋 2/5+ 導出函數。新增：

| 函數 | 最少用例 | 關鍵邊界 |
|------|---------|---------|
| `expandPath` | 6 | `~/` 展開、絕對路徑直通、相對路徑、空串、含 null 字節、`~user` 格式 |
| `toRelativePath` | 3 | 同級文件、子目錄、父目錄 |
| `sanitizePath` | 3 | 正常路徑、含 `..` 段、空串 |

`containsPathTraversal` 補充：
- URL 編碼 `%2e%2e%2f`（確認不匹配，記錄爲非需求）
- 混合分隔符 `foo/..\bar`

`normalizePathForConfigKey` 補充：
- 混合分隔符 `foo/bar\baz`
- 冗餘分隔符 `foo//bar`
- Windows 盤符 `C:\foo\bar`

---

## 11.3 `src/utils/__tests__/uuid.test.ts`

| 改動 | 說明 |
|------|------|
| 大寫測試斷言強化 | `not.toBeNull()` → 驗證標準化輸出（小寫+連字符格式） |
| 新增 `createAgentId` | 3 用例：無 label / 有 label / 輸出格式正則 `/^a[a-z]*-[a-f0-9]{16}$/` |
| 前後空白 | `" 550e8400-...  "` 期望 `null` |

---

## 11.4 `src/utils/__tests__/semver.test.ts`

| 用例 | 輸入 | 期望 |
|------|------|------|
| pre-release 比較 | `gt("1.0.0", "1.0.0-alpha")` | `true` |
| pre-release 間比較 | `order("1.0.0-alpha", "1.0.0-beta")` | `-1` |
| tilde range | `satisfies("1.2.5", "~1.2.3")` | `true` |
| `*` 通配符 | `satisfies("2.0.0", "*")` | `true` |
| 畸形版本 | `order("abc", "1.0.0")` | 確認不拋錯 |
| `0.0.0` | `gt("0.0.0", "0.0.0")` | `false` |

---

## 11.5 `src/utils/__tests__/hash.test.ts`

| 改動 | 當前 | 改爲 |
|------|------|------|
| djb2 32 位檢查 | `hash \| 0`（恆 true） | `Number.isSafeInteger(hash) && Math.abs(hash) <= 0x7FFFFFFF` |
| hashContent 空串 | 未測試 | 新增 |
| hashContent 格式 | 未驗證輸出爲數字串 | `toMatch(/^\d+$/)` |
| hashPair 空串 | 未測試 | `hashPair("", "b")`, `hashPair("", "")` |
| 已知答案 | 無 | 斷言 `djb2Hash("hello")` 爲特定值（需先在控制檯執行一次確定） |

---

## 11.6 `src/utils/__tests__/claudemd.test.ts`

當前僅覆蓋 3 個輔助函數。新增：

| 用例 | 函數 | 說明 |
|------|------|------|
| 未閉合註釋 | `stripHtmlComments` | `"<!-- no close some text"` → 原樣返回 |
| 跨行註釋 | `stripHtmlComments` | `"<!--\nmulti\nline\n-->text"` → `"text"` |
| 同行註釋+內容 | `stripHtmlComments` | `"<!-- note -->some text"` → `"some text"` |
| 內聯程式碼中的註釋 | `stripHtmlComments` | `` `<!-- kept -->` `` → 保留 |
| 大小寫不敏感 | `isMemoryFilePath` | `"claude.md"`, `"CLAUDE.MD"` |
| 非 .md 規則文件 | `isMemoryFilePath` | `.claude/rules/foo.txt` → `false` |
| 空數組 | `getLargeMemoryFiles` | `[]` → `[]` |

---

## 11.7 `src/tools/FileEditTool/__tests__/utils.test.ts`

| 函數 | 新增用例 |
|------|---------|
| `normalizeQuotes` | 混合引號 `"`she said 'hello'"` |
| `stripTrailingWhitespace` | CR-only `\r`、無尾部換行、全空白串 |
| `findActualString` | 空 content、Unicode content |
| `preserveQuoteStyle` | 單引號、縮寫中的撇號（如 `it's`）、空串 |
| `applyEditToFile` | `replaceAll=true` 零匹配、`oldString` 無尾部 `\n`、多行內容 |

---

## 11.8 `src/utils/model/__tests__/providers.test.ts`

| 改動 | 說明 |
|------|------|
| 刪除 `originalEnv` | 未使用，消除死程式碼 |
| env 恢復改爲快照 | `beforeEach` 保存 `process.env`，`afterEach` 恢復 |
| 新增三變量同時設置 | bedrock + vertex + foundry 全部爲 `"1"`，驗證優先級 |
| 新增非 `"1"` 值 | `"true"`, `"0"`, `""` |
| `isFirstPartyAnthropicBaseUrl` | URL 含路徑 `/v1`、含尾斜槓、非 HTTPS |

---

## 11.9 `src/utils/__tests__/hyperlink.test.ts`

| 用例 | 說明 |
|------|------|
| 空 URL | `createHyperlink("http://x.com", "", { supported: true })` 不拋錯 |
| undefined supportsHyperlinks | 選項未傳時走預設檢測 |
| 非 ant staging URL | `USER_TYPE !== "ant"` 時 staging 返回 `false` |

---

## 11.10 `src/utils/__tests__/objectGroupBy.test.ts`

| 用例 | 說明 |
|------|------|
| key 返回 undefined | `(_, i) => undefined` → 全部歸入 `undefined` 組 |
| key 爲特殊字符 | `({ name }) => name` 含空格/中文 |

---

## 11.11 `src/utils/__tests__/CircularBuffer.test.ts`

| 用例 | 說明 |
|------|------|
| capacity=1 | 添加 2 個元素，僅保留最後一個 |
| 空 buffer 呼叫 getRecent | 返回空數組 |
| getRecent(0) | 返回空數組 |

---

## 11.12 `src/utils/__tests__/contentArray.test.ts`

| 用例 | 說明 |
|------|------|
| 混合交替 | `[tool_result, text, tool_result]` — 驗證插入到正確位置 |

---

## 11.13 `src/utils/__tests__/argumentSubstitution.test.ts`

| 用例 | 說明 |
|------|------|
| 轉義引號 | `"he said \"hello\""` |
| 越界索引 | `$ARGUMENTS[99]`（參數不夠時） |
| 多佔位符 | `"cmd $0 $1 $0"` |

---

## 11.14 `src/utils/__tests__/messages.test.ts`

| 改動 | 說明 |
|------|------|
| `normalizeMessages` 斷言加強 | 驗證拆分後的訊息內容，不只是長度 |
| `isNotEmptyMessage` 空白 | `[{ type: "text", text: "  " }]` |

---

## 驗收標準

- [ ] `bun test` 全部通過
- [ ] 目標文件評分從 ACCEPTABLE 提升至 GOOD
- [ ] 無 `toContain` 用於精確值檢查的場景
