# WEB_SEARCH_TOOL — 網頁搜索工具

> 實現狀態：適配器架構完成，Bing 適配器爲當前預設後端
> 引用數：核心工具，無 feature flag 門控（始終啓用）

## 一、功能概述

WebSearchTool 讓模型可以搜索互聯網取得最新信息。原始實現僅支援 Anthropic API 服務端搜索（`web_search_20250305` server tool），在第三方代理端點下不可用。現已重構爲適配器架構，新增 Bing 搜索頁面解析作爲 fallback，確保任何 API 端點都能使用搜索功能。

## 二、實現架構

### 2.1 適配器模式

```
WebSearchTool.call()
       │
       ▼
  createAdapter()  ← 適配器工廠
       │
       ├── ApiSearchAdapter  — Anthropic 官方 API 服務端搜索
       │     └── 使用 web_search_20250305 server tool
       │         通過 queryModelWithStreaming 二次呼叫 API
       │
       └── BingSearchAdapter — Bing HTML 抓取 + 正則提取（當前預設）
             └── 直接抓取 Bing 搜索頁 HTML
                 正則提取 b_algo 塊中的標題/URL/摘要
```

### 2.2 模組結構

| 模組 | 文件 | 說明 |
|------|------|------|
| 工具入口 | `src/tools/WebSearchTool/WebSearchTool.ts` | `buildTool()` 定義：schema、權限、執行、輸出格式化 |
| 工具 prompt | `src/tools/WebSearchTool/prompt.ts` | 搜索工具的系統提示詞 |
| UI 渲染 | `src/tools/WebSearchTool/UI.tsx` | 搜索結果的終端渲染組件 |
| 適配器介面 | `src/tools/WebSearchTool/adapters/types.ts` | `WebSearchAdapter` 介面、`SearchResult`/`SearchOptions`/`SearchProgress` 類型 |
| 適配器工廠 | `src/tools/WebSearchTool/adapters/index.ts` | `createAdapter()` 工廠函數，選擇後端 |
| API 適配器 | `src/tools/WebSearchTool/adapters/apiAdapter.ts` | 封裝原有 `queryModelWithStreaming` 邏輯，使用 server tool |
| Bing 適配器 | `src/tools/WebSearchTool/adapters/bingAdapter.ts` | Bing HTML 抓取 + 正則解析 |
| 單元測試 | `src/tools/WebSearchTool/__tests__/bingAdapter.test.ts` | 32 個測試用例 |
| 集成測試 | `src/tools/WebSearchTool/__tests__/bingAdapter.integration.ts` | 真實網絡請求驗證 |

### 2.3 資料流

```
模型呼叫 WebSearchTool(query, allowed_domains, blocked_domains)
       │
       ▼
  validateInput() — 校驗 query 非空、allowed/block 不共存
       │
       ▼
  createAdapter() → BingSearchAdapter（當前硬編碼）
       │
       ▼
  adapter.search(query, { allowedDomains, blockedDomains, signal, onProgress })
       │
       ├── onProgress({ type: 'query_update', query })
       │
       ├── axios.get(bing.com/search?q=...&setmkt=en-US)
       │     └── 13 個 Edge 瀏覽器請求頭
       │
       ├── extractBingResults(html) — 正則提取 <li class="b_algo"> 塊
       │     ├── resolveBingUrl() — 解碼 base64 重定向 URL
       │     ├── extractSnippet() — 三級降級摘要提取
       │     └── decodeHtmlEntities() — he.decode
       │
       ├── 客戶端域名過濾 (allowedDomains / blockedDomains)
       │
       ├── onProgress({ type: 'search_results_received', resultCount })
       │
       ▼
  格式化爲 markdown 連結列表返回給模型
```

## 三、Bing 適配器技術細節

### 3.1 反爬繞過

使用 13 個 Edge 瀏覽器請求頭（含 `Sec-Ch-Ua`、`Sec-Fetch-*` 等），避免 Bing 返回 JS 渲染的空頁面：

```typescript
const BROWSER_HEADERS = {
  'User-Agent': '...Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Sec-Ch-Ua': '"Microsoft Edge";v="131", "Chromium";v="131", ...',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  // ... 共 13 個標頭
}
```

`setmkt=en-US` 參數強制美式英語市場，避免 IP 地理定位導致區域化結果。

### 3.2 URL 解碼（`resolveBingUrl()`）

Bing 返回的重定向 URL 格式：`bing.com/ck/a?...&u=a1aHR0cHM6Ly9...`

- `u` 參數前 2 字符爲協議前綴：`a1` = https，`a0` = http
- 剩餘部分爲 base64url 編碼的真實 URL
- Bing 內部連結和相對路徑被過濾返回 `undefined`

### 3.3 摘要提取（`extractSnippet()`）

三級降級策略：

1. `<p class="b_lineclamp...">` — Bing 的搜索摘要段落
2. `<div class="b_caption">` 內的 `<p>` — 備選摘要位置
3. `<div class="b_caption">` 直接文本 — 最終 fallback

### 3.4 域名過濾

客戶端側實現，支援子域名匹配：
- `allowedDomains`：白名單，結果域名必須匹配列表中的某項（含子域名）
- `blockedDomains`：黑名單，匹配的結果被過濾
- 兩者不可同時使用（`validateInput` 校驗）

## 四、適配器選擇邏輯

當前 `createAdapter()` 硬編碼返回 `BingSearchAdapter`，原邏輯已註釋保留：

```typescript
export function createAdapter(): WebSearchAdapter {
  return new BingSearchAdapter()
  // 註釋保留的選擇邏輯：
  // 1. WEB_SEARCH_ADAPTER 環境變量強制指定 api|bing
  // 2. isFirstPartyAnthropicBaseUrl() → API 適配器
  // 3. 第三方端點 → Bing 適配器
}
```

恢復自動選擇：取消 `index.ts` 中的註釋即可。

## 五、介面定義

### WebSearchAdapter

```typescript
interface WebSearchAdapter {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>
}

interface SearchResult {
  title: string
  url: string
  snippet?: string
}

interface SearchOptions {
  allowedDomains?: string[]
  blockedDomains?: string[]
  signal?: AbortSignal
  onProgress?: (progress: SearchProgress) => void
}

interface SearchProgress {
  type: 'query_update' | 'search_results_received'
  query?: string
  resultCount?: number
}
```

### 工具 Input Schema

```typescript
{
  query: string              // 搜索關鍵詞，最少 2 字符
  allowed_domains?: string[] // 域名白名單
  blocked_domains?: string[] // 域名黑名單
}
```

## 六、檔案索引

| 文件 | 職責 |
|------|------|
| `src/tools/WebSearchTool/WebSearchTool.ts` | 工具定義入口 |
| `src/tools/WebSearchTool/prompt.ts` | 搜索工具 prompt |
| `src/tools/WebSearchTool/UI.tsx` | 終端 UI 渲染 |
| `src/tools/WebSearchTool/adapters/types.ts` | 適配器介面 |
| `src/tools/WebSearchTool/adapters/index.ts` | 適配器工廠 |
| `src/tools/WebSearchTool/adapters/apiAdapter.ts` | API 服務端搜索適配器 |
| `src/tools/WebSearchTool/adapters/bingAdapter.ts` | Bing HTML 解析適配器 |
| `src/tools/WebSearchTool/__tests__/bingAdapter.test.ts` | 單元測試 (32 cases) |
| `src/tools/WebSearchTool/__tests__/bingAdapter.integration.ts` | 集成測試 |
| `src/tools.ts` | 工具註冊 |
