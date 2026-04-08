# WEB_BROWSER_TOOL — 瀏覽器工具

> Feature Flag: `FEATURE_WEB_BROWSER_TOOL=1`
> 實現狀態：核心實現缺失，面板爲 Stub，佈線完整
> 引用數：4

## 一、功能概述

WEB_BROWSER_TOOL 讓模型可以啓動瀏覽器實例、導航網頁、與頁面元素交互。使用 Bun 的內置 WebView API 提供無頭/有頭瀏覽器能力。

## 二、實現架構

### 2.1 模組狀態

| 模組 | 文件 | 狀態 |
|------|------|------|
| 瀏覽器面板 | `src/tools/WebBrowserTool/WebBrowserPanel.ts` | **Stub** — 返回 null |
| 瀏覽器工具 | `src/tools/WebBrowserTool/WebBrowserTool.ts` | **缺失** |
| REPL 集成 | `src/screens/REPL.tsx` | **佈線** — 渲染 WebBrowserPanel |
| 工具註冊 | `src/tools.ts` | **佈線** — 動態加載 |
| WebView 檢測 | `src/main.tsx` | **佈線** — `'WebView' in Bun` 檢測 |

### 2.2 預期資料流

```
模型呼叫 WebBrowserTool
         │
         ▼
Bun WebView 建立瀏覽器實例
         │
         ├── navigate(url) — 導航到 URL
         ├── click(selector) — 點擊元素
         ├── screenshot() — 截取頁面截圖
         └── extract(selector) — 提取頁面內容
         │
         ▼
結果返回給模型
         │
         ▼
WebBrowserPanel 在 REPL 側邊顯示瀏覽器狀態
```

## 三、需要補全的內容

| 模組 | 工作量 | 說明 |
|------|--------|------|
| `WebBrowserTool.ts` | 大 | 工具 schema + Bun WebView API 執行 |
| `WebBrowserPanel.tsx` | 中 | REPL 側邊欄瀏覽器狀態面板 |

## 四、關鍵設計決策

1. **Bun WebView API**：使用 Bun 內置的 WebView 而非外部瀏覽器驅動（Puppeteer/Playwright）
2. **REPL 側邊面板**：瀏覽器狀態在 REPL 佈局中獨立渲染
3. **Bun 特性檢測**：`'WebView' in Bun` 檢查執行時是否支援

## 五、使用方式

```bash
FEATURE_WEB_BROWSER_TOOL=1 bun run dev
```

## 六、檔案索引

| 文件 | 職責 |
|------|------|
| `src/tools/WebBrowserTool/WebBrowserPanel.ts` | 面板組件（stub） |
| `src/tools/WebBrowserTool/WebBrowserTool.ts` | 工具實現（缺失） |
| `src/screens/REPL.tsx:273,4582` | 面板渲染 |
| `src/tools.ts:115-116` | 工具註冊 |
