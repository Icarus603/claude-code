# 工具函數（純函數）測試計劃

## 概述

覆蓋 `src/utils/` 下所有可獨立單元測試的純函數。這些函數無外部依賴，輸入輸出確定性強，是測試金字塔的底層基石。

## 被測文件

| 文件 | 狀態 | 關鍵導出 |
|------|------|----------|
| `src/utils/array.ts` | **已有測試** | intersperse, count, uniq |
| `src/utils/set.ts` | **已有測試** | difference, intersects, every, union |
| `src/utils/xml.ts` | 待測 | escapeXml, escapeXmlAttr |
| `src/utils/hash.ts` | 待測 | djb2Hash, hashContent, hashPair |
| `src/utils/stringUtils.ts` | 待測 | escapeRegExp, capitalize, plural, firstLineOf, countCharInString, normalizeFullWidthDigits, normalizeFullWidthSpace, safeJoinLines, truncateToLines, EndTruncatingAccumulator |
| `src/utils/semver.ts` | 待測 | gt, gte, lt, lte, satisfies, order |
| `src/utils/uuid.ts` | 待測 | validateUuid, createAgentId |
| `src/utils/format.ts` | 待測 | formatFileSize, formatSecondsShort, formatDuration, formatNumber, formatTokens, formatRelativeTime, formatRelativeTimeAgo |
| `src/utils/json.ts` | 待測 | safeParseJSON, safeParseJSONC, parseJSONL, addItemToJSONCArray |
| `src/utils/truncate.ts` | 待測 | truncatePathMiddle, truncateToWidth, truncateStartToWidth, truncateToWidthNoEllipsis, truncate, wrapText |
| `src/utils/diff.ts` | 待測 | adjustHunkLineNumbers, getPatchFromContents |
| `src/utils/frontmatterParser.ts` | 待測 | parseFrontmatter, splitPathInFrontmatter, parsePositiveIntFromFrontmatter, parseBooleanFrontmatter, parseShellFrontmatter |
| `src/utils/file.ts` | 待測（純函數部分） | convertLeadingTabsToSpaces, addLineNumbers, stripLineNumberPrefix, pathsEqual, normalizePathForComparison |
| `src/utils/glob.ts` | 待測（純函數部分） | extractGlobBaseDirectory |
| `src/utils/tokens.ts` | 待測 | getTokenCountFromUsage |
| `src/utils/path.ts` | 待測（純函數部分） | containsPathTraversal, normalizePathForConfigKey |

---

## 測試用例

### src/utils/xml.ts — 測試文件: `src/utils/__tests__/xml.test.ts`

#### describe('escapeXml')

- test('escapes ampersand') — `&` → `&amp;`
- test('escapes less-than') — `<` → `&lt;`
- test('escapes greater-than') — `>` → `&gt;`
- test('does not escape quotes') — `"` 和 `'` 保持原樣
- test('handles empty string') — `""` → `""`
- test('handles string with no special chars') — `"hello"` 原樣返回
- test('escapes multiple special chars in one string') — `<a & b>` → `&lt;a &amp; b&gt;`

#### describe('escapeXmlAttr')

- test('escapes all xml chars plus quotes') — `"` → `&quot;`, `'` → `&apos;`
- test('escapes double quotes') — `he said "hi"` 正確轉義
- test('escapes single quotes') — `it's` 正確轉義

---

### src/utils/hash.ts — 測試文件: `src/utils/__tests__/hash.test.ts`

#### describe('djb2Hash')

- test('returns consistent hash for same input') — 相同輸入返回相同結果
- test('returns different hashes for different inputs') — 不同輸入大概率不同
- test('returns a 32-bit integer') — 結果在 int32 範圍內
- test('handles empty string') — 空字符串有確定的哈希值
- test('handles unicode strings') — 中文/emoji 等正確處理

#### describe('hashContent')

- test('returns consistent hash for same content') — 確定性
- test('returns string result') — 返回值爲字符串

#### describe('hashPair')

- test('returns consistent hash for same pair') — 確定性
- test('order matters') — hashPair(a, b) ≠ hashPair(b, a)
- test('handles empty strings')

---

### src/utils/stringUtils.ts — 測試文件: `src/utils/__tests__/stringUtils.test.ts`

#### describe('escapeRegExp')

- test('escapes dots') — `.` → `\\.`
- test('escapes asterisks') — `*` → `\\*`
- test('escapes brackets') — `[` → `\\[`
- test('escapes all special chars') — `.*+?^${}()|[]\` 全部轉義
- test('leaves normal chars unchanged') — `hello` 原樣
- test('escaped string works in RegExp') — `new RegExp(escapeRegExp('a.b'))` 精確匹配 `a.b`

#### describe('capitalize')

- test('uppercases first char') — `"foo"` → `"Foo"`
- test('does NOT lowercase rest') — `"fooBar"` → `"FooBar"`（區別於 lodash capitalize）
- test('handles single char') — `"a"` → `"A"`
- test('handles empty string') — `""` → `""`
- test('handles already capitalized') — `"Foo"` → `"Foo"`

#### describe('plural')

- test('returns singular for n=1') — `plural(1, 'file')` → `'file'`
- test('returns plural for n=0') — `plural(0, 'file')` → `'files'`
- test('returns plural for n>1') — `plural(3, 'file')` → `'files'`
- test('uses custom plural form') — `plural(2, 'entry', 'entries')` → `'entries'`

#### describe('firstLineOf')

- test('returns first line of multi-line string') — `"a\nb\nc"` → `"a"`
- test('returns full string when no newline') — `"hello"` → `"hello"`
- test('handles empty string') — `""` → `""`
- test('handles string starting with newline') — `"\nhello"` → `""`

#### describe('countCharInString')

- test('counts occurrences') — `countCharInString("aabac", "a")` → `3`
- test('returns 0 when char not found') — `countCharInString("hello", "x")` → `0`
- test('handles empty string') — `countCharInString("", "a")` → `0`
- test('respects start position') — `countCharInString("aaba", "a", 2)` → `1`

#### describe('normalizeFullWidthDigits')

- test('converts full-width digits to half-width') — `"０１２３"` → `"0123"`
- test('leaves half-width digits unchanged') — `"0123"` → `"0123"`
- test('mixed content') — `"port ８０８０"` → `"port 8080"`

#### describe('normalizeFullWidthSpace')

- test('converts ideographic space to regular space') — `"\u3000"` → `" "`
- test('converts multiple spaces') — `"a\u3000b\u3000c"` → `"a b c"`

#### describe('safeJoinLines')

- test('joins lines with default delimiter') — `["a","b"]` → `"a,b"`
- test('truncates when exceeding maxSize') — 超限時截斷並添加 `...[truncated]`
- test('handles empty array') — `[]` → `""`
- test('uses custom delimiter') — delimiter 爲 `"\n"` 時按行連接

#### describe('truncateToLines')

- test('returns full text when within limit') — 行數不超限時原樣返回
- test('truncates and adds ellipsis') — 超限時截斷並加 `…`
- test('handles exact limit') — 剛好等於 maxLines 時不截斷
- test('handles single line') — 單行文本不截斷

#### describe('EndTruncatingAccumulator')

- test('accumulates strings normally within limit')
- test('truncates when exceeding maxSize')
- test('reports truncated status correctly')
- test('reports totalBytes including truncated content')
- test('toString includes truncation marker')
- test('clear resets all state')
- test('append with Buffer works') — 接受 Buffer 類型

---

### src/utils/semver.ts — 測試文件: `src/utils/__tests__/semver.test.ts`

#### describe('gt / gte / lt / lte')

- test('gt: 2.0.0 > 1.0.0') → true
- test('gt: 1.0.0 > 1.0.0') → false
- test('gte: 1.0.0 >= 1.0.0') → true
- test('lt: 1.0.0 < 2.0.0') → true
- test('lte: 1.0.0 <= 1.0.0') → true
- test('handles pre-release versions') — `1.0.0-beta < 1.0.0`

#### describe('satisfies')

- test('version satisfies caret range') — `satisfies('1.2.3', '^1.0.0')` → true
- test('version does not satisfy range') — `satisfies('2.0.0', '^1.0.0')` → false
- test('exact match') — `satisfies('1.0.0', '1.0.0')` → true

#### describe('order')

- test('returns -1 for lesser') — `order('1.0.0', '2.0.0')` → -1
- test('returns 0 for equal') — `order('1.0.0', '1.0.0')` → 0
- test('returns 1 for greater') — `order('2.0.0', '1.0.0')` → 1

---

### src/utils/uuid.ts — 測試文件: `src/utils/__tests__/uuid.test.ts`

#### describe('validateUuid')

- test('accepts valid v4 UUID') — `'550e8400-e29b-41d4-a716-446655440000'` → 返回 UUID
- test('returns null for invalid format') — `'not-a-uuid'` → null
- test('returns null for empty string') — `''` → null
- test('returns null for null/undefined input')
- test('accepts uppercase UUIDs') — 大寫字母有效

#### describe('createAgentId')

- test('returns string starting with "a"') — 前綴爲 `a`
- test('has correct length') — 前綴 + 16 hex 字符
- test('generates unique ids') — 連續兩次呼叫結果不同

---

### src/utils/format.ts — 測試文件: `src/utils/__tests__/format.test.ts`

#### describe('formatFileSize')

- test('formats bytes') — `500` → `"500 bytes"`
- test('formats kilobytes') — `1536` → `"1.5KB"`
- test('formats megabytes') — `1572864` → `"1.5MB"`
- test('formats gigabytes') — `1610612736` → `"1.5GB"`
- test('removes trailing .0') — `1024` → `"1KB"` (不是 `"1.0KB"`)

#### describe('formatSecondsShort')

- test('formats milliseconds to seconds') — `1234` → `"1.2s"`
- test('formats zero') — `0` → `"0.0s"`

#### describe('formatDuration')

- test('formats seconds') — `5000` → `"5s"`
- test('formats minutes and seconds') — `65000` → `"1m 5s"`
- test('formats hours') — `3661000` → `"1h 1m 1s"`
- test('formats days') — `90061000` → `"1d 1h 1m"`
- test('returns "0s" for zero') — `0` → `"0s"`
- test('hideTrailingZeros omits zero components') — `3600000` + `hideTrailingZeros` → `"1h"`
- test('mostSignificantOnly returns largest unit') — `3661000` + `mostSignificantOnly` → `"1h"`

#### describe('formatNumber')

- test('formats thousands') — `1321` → `"1.3k"`
- test('formats small numbers as-is') — `900` → `"900"`
- test('lowercase output') — `1500` → `"1.5k"` (不是 `"1.5K"`)

#### describe('formatTokens')

- test('strips .0 suffix') — `1000` → `"1k"` (不是 `"1.0k"`)
- test('keeps non-zero decimal') — `1500` → `"1.5k"`

#### describe('formatRelativeTime')

- test('formats past time') — now - 3600s → `"1h ago"` (narrow style)
- test('formats future time') — now + 3600s → `"in 1h"` (narrow style)
- test('formats less than 1 second') — now → `"0s ago"`
- test('uses custom now parameter for deterministic output')

---

### src/utils/json.ts — 測試文件: `src/utils/__tests__/json.test.ts`

#### describe('safeParseJSON')

- test('parses valid JSON') — `'{"a":1}'` → `{ a: 1 }`
- test('returns null for invalid JSON') — `'not json'` → null
- test('returns null for null input') — `null` → null
- test('returns null for undefined input') — `undefined` → null
- test('returns null for empty string') — `""` → null
- test('handles JSON with BOM') — BOM 前綴不影響解析
- test('caches results for repeated calls') — 同一輸入不重複解析

#### describe('safeParseJSONC')

- test('parses JSON with comments') — 含 `//` 註釋的 JSON 正確解析
- test('parses JSON with trailing commas') — 寬鬆模式
- test('returns null for invalid input')
- test('returns null for null input')

#### describe('parseJSONL')

- test('parses multiple JSON lines') — `'{"a":1}\n{"b":2}'` → `[{a:1}, {b:2}]`
- test('skips malformed lines') — 含錯誤行時跳過該行
- test('handles empty input') — `""` → `[]`
- test('handles trailing newline') — 尾部換行不產生空元素
- test('accepts Buffer input') — Buffer 類型同樣工作
- test('handles BOM prefix')

#### describe('addItemToJSONCArray')

- test('adds item to existing array') — `[1, 2]` + 3 → `[1, 2, 3]`
- test('creates new array for empty content') — `""` + item → `[item]`
- test('creates new array for non-array content') — `'"hello"'` + item → `[item]`
- test('preserves comments in JSONC') — 註釋不被丟棄
- test('handles empty array') — `"[]"` + item → `[item]`

---

### src/utils/diff.ts — 測試文件: `src/utils/__tests__/diff.test.ts`

#### describe('adjustHunkLineNumbers')

- test('shifts line numbers by positive offset') — 所有 hunk 的 oldStart/newStart 增加 offset
- test('shifts by negative offset') — 負 offset 減少行號
- test('handles empty hunk array') — `[]` → `[]`

#### describe('getPatchFromContents')

- test('returns empty array for identical content') — 相同內容無差異
- test('detects added lines') — 新內容多出行
- test('detects removed lines') — 舊內容缺少行
- test('detects modified lines') — 行內容變化
- test('handles empty old content') — 從空文件到有內容
- test('handles empty new content') — 刪除所有內容

---

### src/utils/frontmatterParser.ts — 測試文件: `src/utils/__tests__/frontmatterParser.test.ts`

#### describe('parseFrontmatter')

- test('extracts YAML frontmatter between --- delimiters') — 正確提取 frontmatter 並返回 body
- test('returns empty frontmatter for content without ---') — 無 frontmatter 時 data 爲空
- test('handles empty content') — `""` 正確處理
- test('handles frontmatter-only content') — 只有 frontmatter 無 body
- test('falls back to quoting on YAML parse error') — 無效 YAML 不崩潰

#### describe('splitPathInFrontmatter')

- test('splits comma-separated paths') — `"a.ts, b.ts"` → `["a.ts", "b.ts"]`
- test('expands brace patterns') — `"*.{ts,tsx}"` → `["*.ts", "*.tsx"]`
- test('handles string array input') — `["a.ts", "b.ts"]` → `["a.ts", "b.ts"]`
- test('respects braces in comma splitting') — 大括號內的逗號不作爲分隔符

#### describe('parsePositiveIntFromFrontmatter')

- test('returns number for valid positive int') — `5` → `5`
- test('returns undefined for negative') — `-1` → undefined
- test('returns undefined for non-number') — `"abc"` → undefined
- test('returns undefined for float') — `1.5` → undefined

#### describe('parseBooleanFrontmatter')

- test('returns true for true') — `true` → true
- test('returns true for "true"') — `"true"` → true
- test('returns false for false') — `false` → false
- test('returns false for other values') — `"yes"`, `1` → false

#### describe('parseShellFrontmatter')

- test('returns bash for "bash"') — 正確識別
- test('returns powershell for "powershell"')
- test('returns undefined for invalid value') — `"zsh"` → undefined

---

### src/utils/file.ts（純函數部分）— 測試文件: `src/utils/__tests__/file.test.ts`

#### describe('convertLeadingTabsToSpaces')

- test('converts single tab to 2 spaces') — `"\thello"` → `"  hello"`
- test('converts multiple leading tabs') — `"\t\thello"` → `"    hello"`
- test('does not convert tabs within line') — `"a\tb"` 保持原樣
- test('handles mixed content')

#### describe('addLineNumbers')

- test('adds line numbers starting from 1') — 每行添加 `N\t` 前綴
- test('respects startLine parameter') — 從指定行號開始
- test('handles empty content')

#### describe('stripLineNumberPrefix')

- test('strips tab-prefixed line number') — `"1\thello"` → `"hello"`
- test('strips padded line number') — `"  1\thello"` → `"hello"`
- test('returns line unchanged when no prefix')

#### describe('pathsEqual')

- test('returns true for identical paths')
- test('handles trailing slashes') — 帶/不帶尾部斜槓視爲相同
- test('handles case sensitivity based on platform')

#### describe('normalizePathForComparison')

- test('normalizes forward slashes')
- test('resolves path for comparison')

---

### src/utils/glob.ts（純函數部分）— 測試文件: `src/utils/__tests__/glob.test.ts`

#### describe('extractGlobBaseDirectory')

- test('extracts static prefix from glob') — `"src/**/*.ts"` → `{ baseDir: "src", relativePattern: "**/*.ts" }`
- test('handles root-level glob') — `"*.ts"` → `{ baseDir: ".", relativePattern: "*.ts" }`
- test('handles deep static path') — `"src/utils/model/*.ts"` → baseDir 爲 `"src/utils/model"`
- test('handles Windows drive root') — `"C:\\Users\\**\\*.ts"` 正確分割

---

### src/utils/tokens.ts（純函數部分）— 測試文件: `src/utils/__tests__/tokens.test.ts`

#### describe('getTokenCountFromUsage')

- test('sums input and output tokens') — `{ input_tokens: 100, output_tokens: 50 }` → 150
- test('includes cache tokens') — cache_creation + cache_read 加入總數
- test('handles zero values') — 全 0 時返回 0

---

### src/utils/path.ts（純函數部分）— 測試文件: `src/utils/__tests__/path.test.ts`

#### describe('containsPathTraversal')

- test('detects ../ traversal') — `"../etc/passwd"` → true
- test('detects mid-path traversal') — `"foo/../../bar"` → true
- test('returns false for safe paths') — `"src/utils/file.ts"` → false
- test('returns false for paths containing .. in names') — `"foo..bar"` → false

#### describe('normalizePathForConfigKey')

- test('converts backslashes to forward slashes') — `"src\\utils"` → `"src/utils"`
- test('leaves forward slashes unchanged')

---

## Mock 需求

本計劃中的函數大部分爲純函數，**不需要 mock**。少數例外：

| 函數 | 依賴 | 處理 |
|------|------|------|
| `hashContent` / `hashPair` | `Bun.hash` | Bun 執行時下自動可用 |
| `formatRelativeTime` | `Date` | 使用 `now` 參數注入確定性時間 |
| `safeParseJSON` | `logError` | 可通過 `shouldLogError: false` 跳過 |
| `safeParseJSONC` | `logError` | mock `logError` 避免測試輸出噪音 |
