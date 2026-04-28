# Claude in Chrome — 用戶操作指南

## 1. 功能簡介

Claude in Chrome 讓 Claude Code 直接控制你的 Chrome 瀏覽器。你可以用自然語言讓 Claude 幫你：

- 打開網頁、導航、前進後退
- 填寫表單、上傳圖片
- 截圖、錄製 GIF
- 讀取頁面內容（DOM、純文本）
- 執行 JavaScript
- 監控網絡請求和控制檯日誌
- 管理標籤頁

## 2. 前置條件

| 條件 | 說明 |
|------|------|
| Claude Code 訂閱 | 需要 Claude Pro、Max 或 Team 訂閱，瀏覽器擴充功能不向免費用戶開放 |
| Chrome 瀏覽器 | 需已安裝 Google Chrome |
| Claude in Chrome 擴展 | 從 Chrome Web Store 安裝（`claude.ai/chrome`） |
| Claude Code CLI | 已通過 `bun run dev` 或構建產物執行 |

## 3. 啓用方式

### Dev 模式

```bash
bun run dev -- --chrome
```

啓動後 Claude 會自動檢測 Chrome 擴展是否已安裝，並註冊瀏覽器控制工具。

### 構建產物

```bash
node dist/cli.js --chrome
```

### 禁用

```bash
bun run dev -- --no-chrome
```

或在 REPL 中通過 `/chrome` 命令切換啓用/禁用狀態。

### 通過設定預設啓用

在 Claude Code 設置中將 `claudeInChromeDefaultEnabled` 設爲 `true`，以後啓動無需加 `--chrome` 參數。

## 4. 使用流程

1. **啓動 CLI** — 加 `--chrome` 參數啓動 Claude Code
2. **確認連接** — REPL 中輸入 `/chrome`，查看擴展狀態是否顯示 "Installed / Connected"
3. **開始對話** — 正常與 Claude 對話，當需要操作瀏覽器時直接說，例如：
   - "打開 https://example.com 並截圖"
   - "在當前頁面搜索關鍵詞 xxx"
   - "填寫登錄表單，用戶名 admin"
   - "幫我錄製當前操作的 GIF"
4. **權限審批** — 首次執行瀏覽器操作時，Claude 會請求你的確認
5. **操作完成** — Claude 完成操作後會返回結果（截圖、文本、執行結果等）

## 5. 可用操作

### 頁面交互

| 操作 | 說明 |
|------|------|
| `navigate` | 導航到指定 URL，或前進/後退 |
| `computer` | 鼠標點擊、移動、拖拽、鍵盤輸入、截圖等（13 種 action） |
| `form_input` | 填寫表單字段 |
| `upload_image` | 上傳圖片到文件輸入框或拖拽區域 |
| `javascript_tool` | 在頁面上下文執行 JavaScript |

### 頁面讀取

| 操作 | 說明 |
|------|------|
| `read_page` | 取得頁面可訪問性樹（DOM 結構） |
| `get_page_text` | 提取頁面純文本內容 |
| `find` | 用自然語言搜索頁面元素 |

### 標籤頁管理

| 操作 | 說明 |
|------|------|
| `tabs_context_mcp` | 取得當前標籤組信息 |
| `tabs_create_mcp` | 建立新標籤頁 |

### 監控與調試

| 操作 | 說明 |
|------|------|
| `read_console_messages` | 讀取瀏覽器控制檯日誌 |
| `read_network_requests` | 讀取網絡請求記錄 |

### 其他

| 操作 | 說明 |
|------|------|
| `resize_window` | 調整瀏覽器窗口尺寸 |
| `gif_creator` | 錄製 GIF 並導出 |
| `shortcuts_list` | 列出可用快捷方式 |
| `shortcuts_execute` | 執行快捷方式 |
| `update_plan` | 向你提交操作計劃供審批 |
| `switch_browser` | 切換到其他 Chrome 瀏覽器（僅 Bridge 模式） |

## 6. 通信模式

Claude in Chrome 支援兩種與瀏覽器通信的方式：

### 本地 Socket（預設）

Chrome 擴展通過 Native Messaging Host 與 CLI 建立 Unix socket 連接。適用於本地開發，無需額外設定。

### Bridge WebSocket

通過 Anthropic 的 bridge 服務中轉，支援遠程操控瀏覽器。需要 claude.ai OAuth 登錄。

## 7. 常見問題

### 擴展顯示未安裝

確認已從 Chrome Web Store 安裝 "Claude in Chrome" 擴展，安裝後重啓瀏覽器。

### 工具未出現在工具列表

檢查啓動時是否加了 `--chrome` 參數，或通過 `/chrome` 命令確認狀態。

### 連接超時

確保 Chrome 瀏覽器正在執行且擴展已啓用。Native Messaging Host 在擴展安裝時自動註冊，如果重裝過擴展需要重啓瀏覽器。

### 不使用 Chrome 功能時

不帶 `--chrome` 參數正常啓動即可，不會加載任何瀏覽器相關模組，不影響其他功能。
