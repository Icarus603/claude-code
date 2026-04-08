# Plan 13 — truncate CJK/Emoji 補充測試

> 優先級：中 | 1 個文件 | 預估新增 ~15 個測試用例

`truncate.ts` 使用 `stringWidth` 和 grapheme segmentation 實現寬度感知截斷，但現有測試僅覆蓋 ASCII。這是核心場景缺失。

---

## 被測函數

- `truncateToWidth(text, maxWidth)` — 尾部截斷加 `…`
- `truncateStartToWidth(text, maxWidth)` — 頭部截斷加 `…`
- `truncateToWidthNoEllipsis(text, maxWidth)` — 尾部截斷無省略號
- `truncatePathMiddle(path, maxLength)` — 路徑中間截斷
- `wrapText(text, maxWidth)` — 按寬度換行

---

## 新增用例

### CJK 全角字符

| 用例 | 函數 | 輸入 | maxWidth | 期望行爲 |
|------|------|------|----------|----------|
| 純中文截斷 | `truncateToWidth` | `"你好世界"` | 4 | `"你好…"` (每個中文字佔 2 寬度) |
| 中英混合 | `truncateToWidth` | `"hello你好"` | 8 | `"hello你…"` |
| 全角不截斷 | `truncateToWidth` | `"你好"` | 4 | `"你好"` (恰好 4) |
| emoji 單字符 | `truncateToWidth` | `"👋"` | 2 | `"👋"` (emoji 通常 2 寬度) |
| emoji 截斷 | `truncateToWidth` | `"hello 👋 world"` | 8 | 確認寬度計算正確 |
| 頭部中文 | `truncateStartToWidth` | `"你好世界"` | 4 | `"…界"` |
| 無省略中文 | `truncateToWidthNoEllipsis` | `"你好世界"` | 4 | `"你好"` |

> **注意**：`stringWidth` 對 CJK/emoji 的寬度計算取決於具體實現。先在 REPL 中執行確認實際寬度再寫斷言：
> ```typescript
> import { stringWidth } from "src/utils/truncate.ts";
> console.log(stringWidth("你好")); // 確認是 4 還是 2
> console.log(stringWidth("👋"));  // 確認 emoji 寬度
> ```

### 路徑中間截斷補充

| 用例 | 輸入 | maxLength | 期望 |
|------|------|-----------|------|
| 檔名超長 | `"/very/long/path/to/MyComponent.tsx"` | 10 | 含 `…` 且以 `.tsx` 結尾 |
| 無斜槓短串 | `"abc"` | 1 | 確認行爲不拋錯 |
| maxLength 極小 | `"/a/b"` | 1 | 確認不拋錯 |
| maxLength=4 | `"/a/b/c.ts"` | 4 | 確認行爲 |

### wrapText 補充

| 用例 | 輸入 | maxWidth | 期望 |
|------|------|----------|------|
| 含換行符 | `"hello\nworld"` | 10 | 保留原有換行 |
| 寬度=0 | `"hello"` | 0 | 空串或原串（確認不拋錯） |

---

## 實施步驟

1. 在 REPL 中確認 `stringWidth` 對 CJK/emoji 的實際返回值
2. 按實際值編寫精確斷言
3. 如果 `stringWidth` 依賴 ICU 或平臺特性，添加平臺檢查（`process.platform !== "win32"` 跳過條件）
4. 執行測試

---

## 驗收標準

- [ ] 至少 5 個 CJK/emoji 相關測試通過
- [ ] 斷言基於實際 `stringWidth` 返回值，非猜測
- [ ] `bun test` 全部通過
