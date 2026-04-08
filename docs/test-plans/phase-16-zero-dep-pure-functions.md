# Phase 16 — 零依賴純函數測試

> 建立日期：2026-04-02
> 預計：+120 tests / 8 files
> 目標：覆蓋所有零外部依賴的純函數/類模組

所有模組均爲純函數或零外部依賴類，mock 成本爲零，ROI 最高。

---

## 16.1 `src/utils/__tests__/stream.test.ts`（~15 tests）

**目標模組**: `src/utils/stream.ts`（76 行）
**導出**: `Stream<T>` class — 手動異步隊列，實現 `AsyncIterator<T>`

| 測試用例 | 驗證點 |
|---------|--------|
| enqueue then read | 單條訊息正確傳遞 |
| enqueue multiple then drain | 多條訊息順序消費 |
| done resolves pending readers | `done()` 後迭代結束 |
| done with no pending readers | 無等待時安全關閉 |
| error rejects pending readers | `error(e)` 傳播異常 |
| error after done | 後續操作安全處理 |
| single-iteration guard | `return()` 後不可再迭代 |
| empty stream done immediately | 無資料時 done 返回 `{ done: true }` |
| concurrent enqueue | 多次 enqueue 不丟失 |
| backpressure | reader 慢於 writer 時不丟資料 |

---

## 16.2 `src/utils/__tests__/abortController.test.ts`（~12 tests）

**目標模組**: `src/utils/abortController.ts`（99 行）
**導出**: `createAbortController()`, `createChildAbortController()`

| 測試用例 | 驗證點 |
|---------|--------|
| parent abort propagates to child | `parent.abort()` → child aborted |
| child abort does NOT propagate to parent | `child.abort()` → parent still active |
| already-aborted parent → child immediately aborted | 建立時即繼承 abort 狀態 |
| child listener cleanup after parent abort | WeakRef 回收後無泄漏 |
| multiple children of same parent | 獨立 abort 傳播 |
| child abort then parent abort | 順序無關 |
| signal.maxListeners raised | MaxListenersExceededWarning 不觸發 |

---

## 16.3 `src/utils/__tests__/bufferedWriter.test.ts`（~14 tests）

**目標模組**: `src/utils/bufferedWriter.ts`（100 行）
**導出**: `createBufferedWriter()`

| 測試用例 | 驗證點 |
|---------|--------|
| single write buffered | write → buffer 累積 |
| flush on size threshold | 超過 maxSize 時自動 flush |
| flush on timer | 定時器觸發 flush |
| immediate mode | `{ immediate: true }` 跳過緩衝 |
| overflow coalescing | overflow 內容合併到下次 flush |
| empty buffer flush | 無資料時 flush 無副作用 |
| close flushes remaining | close 觸發最終 flush |
| multiple writes before flush | 批量寫入合併 |
| flush callback receives concatenated data | writeFn 參數正確 |

**Mock**: 注入 `writeFn` 回調，可選 fake timers

---

## 16.4 `src/utils/__tests__/gitDiff.test.ts`（~20 tests）

**目標模組**: `src/utils/gitDiff.ts`（532 行）
**可測函數**: `parseGitNumstat()`, `parseGitDiff()`, `parseShortstat()`

| 測試用例 | 驗證點 |
|---------|--------|
| parseGitNumstat — single file | `1\t2\tpath` → { added: 1, deleted: 2, file: "path" } |
| parseGitNumstat — binary file | `-\t-\timage.png` → binary flag |
| parseGitNumstat — rename | `{ old => new }` 格式解析 |
| parseGitNumstat — empty diff | 空字符串 → [] |
| parseGitNumstat — multiple files | 多行正確分割 |
| parseGitDiff — added lines | `+` 開頭行計數 |
| parseGitDiff — deleted lines | `-` 開頭行計數 |
| parseGitDiff — hunk header | `@@ -a,b +c,d @@` 解析 |
| parseGitDiff — new file mode | `new file mode 100644` 檢測 |
| parseGitDiff — deleted file mode | `deleted file mode` 檢測 |
| parseGitDiff — binary diff | Binary files differ 處理 |
| parseShortstat — all components | `1 file changed, 5 insertions(+), 3 deletions(-)` |
| parseShortstat — insertions only | 無 deletions |
| parseShortstat — deletions only | 無 insertions |
| parseShortstat — files only | 僅 file changed |
| parseShortstat — empty | 空字符串 → 預設值 |
| parseShortstat — rename | `1 file changed, ...` 重命名 |

**Mock**: 無需 mock — 全部是純字符串解析

---

## 16.5 `src/__tests__/history.test.ts`（~18 tests）

**目標模組**: `src/history.ts`（464 行）
**可測函數**: `parseReferences()`, `expandPastedTextRefs()`, `formatPastedTextRef()`, `formatImageRef()`, `getPastedTextRefNumLines()`

| 測試用例 | 驗證點 |
|---------|--------|
| parseReferences — text ref | `#1` → [{ type: "text", ref: 1 }] |
| parseReferences — image ref | `@1` → [{ type: "image", ref: 1 }] |
| parseReferences — multiple refs | `#1 #2 @3` → 3 refs |
| parseReferences — no refs | `"hello"` → [] |
| parseReferences — duplicate refs | `#1 #1` → 去重或保留 |
| parseReferences — zero ref | `#0` → 邊界 |
| parseReferences — large ref | `#999` → 正常 |
| formatPastedTextRef — basic | 輸出格式驗證 |
| formatPastedTextRef — multiline | 多行內容格式 |
| getPastedTextRefNumLines — 1 line | 返回 1 |
| getPastedTextRefNumLines — multiple lines | 換行計數 |
| expandPastedTextRefs — single ref | 替換單個引用 |
| expandPastedTextRefs — multiple refs | 替換多個引用 |
| expandPastedTextRefs — no refs | 原樣返回 |
| expandPastedTextRefs — mixed content | 文本 + 引用混合 |
| formatImageRef — basic | 輸出格式 |

**Mock**: `mock.module("src/bootstrap/state.ts", ...)` 解鎖模組

---

## 16.6 `src/utils/__tests__/sliceAnsi.test.ts`（~16 tests）

**目標模組**: `src/utils/sliceAnsi.ts`（91 行）
**導出**: `sliceAnsi()` — ANSI 感知的字符串切片

| 測試用例 | 驗證點 |
|---------|--------|
| plain text slice | `"hello".slice(1,3)` 等價 |
| preserve ANSI codes | `\x1b[31mhello\x1b[0m` 切片後保留顏色 |
| close opened styles | 切片點在 ANSI 樣式中間時正確關閉 |
| hyperlink handling | OSC 8 超連結不被切斷 |
| combining marks (diacritics) | `é` = `e\u0301` 不被切開 |
| Devanagari matras | 零寬字符不被切斷 |
| full-width characters | CJK 字符寬度 = 2 |
| empty slice | 返回空字符串 |
| full slice | 返回完整字符串 |
| boundary at ANSI code | 邊界恰好在 escape 序列上 |
| nested ANSI styles | 多層嵌套時正確處理 |
| slice start > end | 空結果 |

**Mock**: `mock.module("@alcalzone/ansi-tokenize", ...)`, `mock.module("ink/stringWidth", ...)`

---

## 16.7 `src/utils/__tests__/treeify.test.ts`（~15 tests）

**目標模組**: `src/utils/treeify.ts`（170 行）
**導出**: `treeify()` — 遞歸樹渲染

| 測試用例 | 驗證點 |
|---------|--------|
| simple flat tree | `{ a: {}, b: {} }` → 2 行 |
| nested tree | `{ a: { b: { c: {} } } }` → 3 行縮進 |
| array values | `[1, 2, 3]` 渲染爲列表 |
| circular reference | 不無限遞歸 |
| empty object | `{}` 處理 |
| single key | 佈局適配 |
| branch vs last-branch character | ├─ vs └─ |
| custom prefix | options 前綴傳遞 |
| deep nesting | 5+ 層縮進正確 |
| mixed object/array | 混合結構 |

**Mock**: `mock.module("figures", ...)`, color 模組 mock

---

## 16.8 `src/utils/__tests__/words.test.ts`（~10 tests）

**目標模組**: `src/utils/words.ts`（800 行，大部分是詞表資料）
**導出**: `generateWordSlug()`, `generateShortWordSlug()`

| 測試用例 | 驗證點 |
|---------|--------|
| generateWordSlug format | `adjective-verb-noun` 三段式 |
| generateShortWordSlug format | `adjective-noun` 兩段式 |
| all parts non-empty | 無空段 |
| hyphen separator | `-` 分隔 |
| all parts from word lists | 成分來自預定義詞表 |
| multiple calls uniqueness | 連續呼叫不總是相同 |
| no consecutive hyphens | 無 `--` |
| lowercase only | 全小寫 |

**Mock**: `mock.module("crypto", ...)` 控制 `randomBytes` 實現確定性測試
