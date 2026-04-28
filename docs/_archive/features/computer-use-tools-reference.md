# Computer Use 工具參考文件

## 概覽

Computer Use 提供 37 個工具，分爲三類：

| 分類 | 平臺 | 工具數 | 說明 |
|------|------|--------|------|
| 通用工具 | 全平臺 | 24 | 官方 Computer Use 標準能力 |
| Windows 專屬工具 | Win32 | 10 | 綁定窗口模式下的增強能力 |
| 教學工具 | 全平臺 | 3 | 分步引導模式（需 teachMode 開啓） |

---

## 一、通用工具（24 個）

全平臺可用。未綁定窗口時，操作對象是整個屏幕。

### 權限與會話

| 工具 | 參數 | 說明 |
|------|------|------|
| `request_access` | `apps[]`, `reason`, `clipboardRead?`, `clipboardWrite?`, `systemKeyCombos?` | 請求操作應用的權限。所有其他工具的前置條件 |
| `list_granted_applications` | — | 列出當前會話已授權的應用 |

### 截圖與顯示

| 工具 | 參數 | 說明 |
|------|------|------|
| `screenshot` | `save_to_disk?` | 截取當前屏幕。綁定窗口時截取綁定窗口（PrintWindow）。返回圖片 + GUI 元素列表（Windows） |
| `zoom` | `region: [x1,y1,x2,y2]` | 截取指定區域的高分辨率圖片。座標基於最近一次全屏截圖 |
| `switch_display` | `display` | 切換截圖的目標顯示器 |

### 鼠標操作

| 工具 | 參數 | 說明 |
|------|------|------|
| `left_click` | `coordinate: [x,y]`, `text?` (修飾鍵) | 左鍵點擊。`text` 可傳 "shift"/"ctrl"/"alt" 實現組合點擊 |
| `double_click` | `coordinate`, `text?` | 雙擊 |
| `triple_click` | `coordinate`, `text?` | 三擊（選整行） |
| `right_click` | `coordinate`, `text?` | 右鍵點擊 |
| `middle_click` | `coordinate`, `text?` | 中鍵點擊 |
| `mouse_move` | `coordinate` | 移動鼠標（不點擊） |
| `left_click_drag` | `coordinate` (終點), `start_coordinate?` (起點) | 拖拽 |
| `left_mouse_down` | — | 按下左鍵不松 |
| `left_mouse_up` | — | 鬆開左鍵 |
| `cursor_position` | — | 取得當前鼠標位置 |

### 鍵盤操作

| 工具 | 參數 | 說明 |
|------|------|------|
| `type` | `text` | 輸入文字 |
| `key` | `text` (如 "ctrl+s"), `repeat?` | 按鍵/組合鍵 |
| `hold_key` | `text`, `duration` (秒) | 按住鍵指定時長 |

### 滾動

| 工具 | 參數 | 說明 |
|------|------|------|
| `scroll` | `coordinate`, `scroll_direction`, `scroll_amount` | 滾動。方向: up/down/left/right |

### 應用管理

| 工具 | 參數 | 說明 |
|------|------|------|
| `open_application` | `app` | 打開應用。Windows 上自動綁定窗口 |

### 剪貼板

| 工具 | 參數 | 說明 |
|------|------|------|
| `read_clipboard` | — | 讀取剪貼板文字 |
| `write_clipboard` | `text` | 寫入剪貼板 |

### 其他

| 工具 | 參數 | 說明 |
|------|------|------|
| `wait` | `duration` (秒) | 等待 |
| `computer_batch` | `actions[]` | 批量執行多個動作（減少 API 往返） |

---

## 二、Windows 專屬工具（10 個）

僅 Windows 平臺可見。核心能力：**綁定窗口後的獨立操作——不搶佔用戶鼠標鍵盤**。

### 工作模式

```
┌──────────────────────────────────────────────────┐
│                  未綁定模式                        │
│  使用通用工具 (left_click/type/key/scroll)          │
│  操作對象：整個屏幕                                 │
│  輸入方式：全局 SendInput（會移動真實鼠標）           │
└──────────────────────────────────────────────────┘
                        │
                  bind_window / open_application
                        ▼
┌──────────────────────────────────────────────────┐
│                  綁定窗口模式                      │
│  使用 Win32 工具 (virtual_mouse/virtual_keyboard)  │
│  操作對象：綁定的窗口                               │
│  輸入方式：SendMessageW（不動真實鼠標/鍵盤）          │
│  可視化：DWM 綠色邊框 + 虛擬光標 + 狀態指示器        │
└──────────────────────────────────────────────────┘
```

### 窗口綁定

| 工具 | 參數 | 說明 |
|------|------|------|
| `bind_window` | `action`: list/bind/unbind/status | 窗口綁定管理 |

**動作詳情：**

| action | 參數 | 說明 |
|--------|------|------|
| `list` | — | 列出所有可見窗口（hwnd、pid、title） |
| `bind` | `title?`, `hwnd?`, `pid?` | 綁定到指定窗口。設置 DWM 綠色邊框 + 啓動虛擬光標 + 啓動狀態指示器 + 短暫激活窗口確保可接收輸入 |
| `unbind` | — | 解除綁定，恢復全屏模式 |
| `status` | — | 查看當前綁定狀態（hwnd、title、pid、窗口矩形） |

### 窗口管理

| 工具 | 參數 | 說明 |
|------|------|------|
| `window_management` | `action`, `x?`, `y?`, `width?`, `height?` | 窗口操作（Win32 API，不走全局快捷鍵） |

**動作詳情：**

| action | 說明 |
|--------|------|
| `minimize` | ShowWindow(SW_MINIMIZE) |
| `maximize` | ShowWindow(SW_MAXIMIZE) |
| `restore` | ShowWindow(SW_RESTORE) — 恢復最小化/最大化 |
| `close` | SendMessage(WM_CLOSE) — 優雅關閉 |
| `focus` | SetForegroundWindow + BringWindowToTop — 激活窗口 |
| `move_offscreen` | SetWindowPos(-32000,-32000) — 移到屏幕外（仍可 SendMessage/PrintWindow） |
| `move_resize` | SetWindowPos — 移動/縮放到指定位置和大小 |
| `get_rect` | GetWindowRect — 取得當前位置和大小 |

### 虛擬鼠標

| 工具 | 參數 | 說明 |
|------|------|------|
| `virtual_mouse` | `action`, `coordinate: [x,y]`, `start_coordinate?` | 在綁定窗口內操作虛擬鼠標 |

**動作詳情：**

| action | 說明 |
|--------|------|
| `click` | 左鍵點擊。虛擬光標移動到座標 + 閃爍動畫 |
| `double_click` | 雙擊 |
| `right_click` | 右鍵點擊 |
| `move` | 移動虛擬光標（不點擊） |
| `drag` | 按住 → 移動 → 鬆開。需 `start_coordinate` 指定起點 |
| `down` | 按下左鍵不松 |
| `up` | 鬆開左鍵 |

**與通用鼠標工具的區別：**

| | 通用 (`left_click` 等) | `virtual_mouse` |
|---|---|---|
| 輸入方式 | SendInput（全局） | SendMessageW（窗口級） |
| 真實鼠標 | 會移動 | **不動** |
| 用戶幹擾 | 有 | **無** |
| 適用場景 | 未綁定時 | **綁定後** |

### 虛擬鍵盤

| 工具 | 參數 | 說明 |
|------|------|------|
| `virtual_keyboard` | `action`, `text`, `duration?`, `repeat?` | 在綁定窗口內操作虛擬鍵盤 |

**動作詳情：**

| action | text 含義 | 說明 |
|--------|----------|------|
| `type` | 要輸入的文字 | SendMessageW(WM_CHAR)，支援 Unicode 中文/emoji |
| `combo` | 組合鍵 (如 "ctrl+s") | WM_KEYDOWN/UP 序列 |
| `press` | 單個鍵名 | 按下不松（配合 release 使用） |
| `release` | 單個鍵名 | 鬆開按鍵 |
| `hold` | 鍵名或組合 | 按住指定秒數後鬆開 |

**與通用鍵盤工具的區別：**

| | 通用 (`type`/`key`) | `virtual_keyboard` |
|---|---|---|
| 輸入方式 | SendInput（全局） | SendMessageW（窗口級） |
| 物理鍵盤 | 會衝突 | **不衝突** |
| 適用場景 | 未綁定時 | **綁定後** |

**注意：** SendMessageW 對 Windows Terminal (ConPTY) 等現代應用無效。這些應用需要使用通用工具 + 窗口激活方式操作。

### 鼠標滾輪

| 工具 | 參數 | 說明 |
|------|------|------|
| `mouse_wheel` | `coordinate: [x,y]`, `delta`, `direction?` | WM_MOUSEWHEEL 鼠標中鍵滾輪 |

**參數說明：**
- `delta`: 正值=向上，負值=向下。每 1 單位 ≈ 3 行
- `direction`: "vertical"（預設）或 "horizontal"
- `coordinate`: 滾輪作用點——決定哪個面板/區域接收滾動

**與通用 `scroll` 的區別：**

| | `scroll` | `mouse_wheel` |
|---|---|---|
| 原理 | WM_VSCROLL/WM_HSCROLL | **WM_MOUSEWHEEL** |
| Excel | ❌ | ✅ |
| 瀏覽器 | ❌ | ✅ |
| 程式碼編輯器 | ❌ | ✅ |

### 元素級操作

| 工具 | 參數 | 說明 |
|------|------|------|
| `click_element` | `name?`, `role?`, `automationId?` | 按無障礙名稱/角色點擊 GUI 元素 |
| `type_into_element` | `name?`, `role?`, `automationId?`, `text` | 按名稱向元素輸入文字 |

**工作原理：**
1. 通過 UI Automation 在綁定窗口中查找匹配元素
2. `click_element`: 先嚐試 InvokePattern（按鈕/菜單），失敗則 SendMessage 點擊 BoundingRect 中心
3. `type_into_element`: 先嚐試 ValuePattern 直接設值，失敗則點擊聚焦 + WM_CHAR 輸入

**適用場景：**
- 截圖中看到元素名稱但座標不精確時
- Accessibility Snapshot 列出了元素的 name/automationId 時
- 比座標點擊更可靠（不受窗口縮放/DPI 影響）

### 終端交互

| 工具 | 參數 | 說明 |
|------|------|------|
| `prompt_respond` | `response_type`, `arrow_direction?`, `arrow_count?`, `text?` | 處理終端 Yes/No/選擇提示 |

**response_type 詳情：**

| response_type | 操作 | 場景 |
|---------------|------|------|
| `yes` | 發送 'y' + Enter | npm "Continue? (y/n)" |
| `no` | 發送 'n' + Enter | 拒絕確認 |
| `enter` | 發送 Enter | 接受預設選項 |
| `escape` | 發送 Escape | 取消操作 |
| `select` | ↑/↓ 箭頭 × N + Enter | inquirer 選擇菜單 |
| `type` | 輸入文字 + Enter | 文本輸入提示 |

### 狀態指示器

| 工具 | 參數 | 說明 |
|------|------|------|
| `status_indicator` | `action`: show/hide/status, `message?` | 控制綁定窗口底部的浮動狀態標籤 |

---

## 三、教學工具（3 個）

需要 `teachMode` 開啓。

| 工具 | 說明 |
|------|------|
| `request_teach_access` | 請求教學引導模式權限 |
| `teach_step` | 顯示一步引導提示，等用戶點 Next |
| `teach_batch` | 批量排隊多步引導 |

---

## 操作流程

### 流程 1：全屏操作（未綁定）

```
request_access(apps=["Notepad"])
open_application(app="Notepad")          ← 自動綁定窗口
screenshot                               ← PrintWindow 截圖 + GUI 元素列表
left_click(coordinate=[500, 300])        ← 全局 SendInput
type(text="hello world")                 ← 全局 SendInput
key(text="ctrl+s")                       ← 全局 SendInput
```

### 流程 2：綁定窗口操作（推薦，不幹擾用戶）

```
request_access(apps=["Notepad"])
bind_window(action="list")               ← 列出所有窗口
bind_window(action="bind", title="記事本") ← 綁定 + 綠色邊框 + 虛擬光標
screenshot                               ← PrintWindow 截取綁定窗口
virtual_mouse(action="click", coordinate=[500, 300])   ← SendMessageW，不動真實鼠標
virtual_keyboard(action="type", text="hello world")    ← SendMessageW，不動物理鍵盤
virtual_keyboard(action="combo", text="ctrl+s")        ← 保存
mouse_wheel(coordinate=[500, 400], delta=-5)           ← 向下滾動
bind_window(action="unbind")             ← 解除綁定
```

### 流程 3：按元素名稱操作

```
bind_window(action="bind", title="記事本")
screenshot                               ← 返回截圖 + GUI elements 列表
click_element(name="保存", role="Button") ← UI Automation 查找並點擊
type_into_element(role="Edit", text="new content")
```

### 流程 4：終端交互

```
bind_window(action="bind", title="PowerShell")
screenshot
prompt_respond(response_type="yes")      ← 回答 y + Enter
prompt_respond(response_type="select", arrow_direction="down", arrow_count=2)  ← 選第3項
```

### 流程 5：Excel/瀏覽器滾動

```
bind_window(action="bind", title="Excel")
screenshot
mouse_wheel(coordinate=[600, 400], delta=-10)            ← 向下滾動 10 格
mouse_wheel(coordinate=[600, 400], delta=5, direction="horizontal")  ← 向右滾動
```

---

## 應用相容性

| 應用類型 | SendMessageW (virtual_*) | 元素操作 (click_element) | 注意 |
|---------|--------------------------|------------------------|------|
| 傳統 Win32 (記事本/寫字板) | ✅ | ✅ | 完美支援 |
| Office (Excel/Word) | ✅ (COM 自動化) | ✅ | 通過 COM API |
| WPF 應用 | ✅ | ✅ | 標準 UIA 支援 |
| Electron/Chrome | ⚠️ 部分 | ⚠️ 部分 | 內部渲染不走 Win32 訊息 |
| UWP/WinUI (Windows Terminal) | ❌ | ❌ | ConPTY 不接受 SendMessageW |
| 瀏覽器網頁內容 | ❌ | ❌ | 需要全局 SendInput |

**對於不支援 SendMessageW 的應用**，使用通用工具 (`left_click`/`type`/`key`) + `window_management(action="focus")` 先激活窗口。

---

## 綁定窗口時的可視化

綁定窗口後自動啓動三層可視化：

1. **DWM 綠色邊框** — 窗口自身的邊框顏色變綠，零偏移
2. **虛擬鼠標光標** — 紅色箭頭圖標，跟隨 virtual_mouse 操作移動，點擊時閃爍
3. **狀態指示器** — 窗口底部浮動標籤，顯示當前操作（通過 status_indicator 控制）

---

## Accessibility Snapshot

每次 `screenshot` 時，如果窗口已綁定，會自動附帶 GUI 元素列表：

```
GUI elements in this window:
[Button] "Save" (120,50 80x30) enabled
[Edit] "" (200,80 400x25) enabled value="hello" id=textBox1
[MenuItem] "File" (10,0 40x25) enabled
[MenuItem] "Edit" (50,0 40x25) enabled
[CheckBox] "Auto-save" (300,50 100x20) enabled id=chkAutoSave
```

模型同時收到 **截圖圖片 + 結構化元素列表**，可以選擇：
- 用座標操作：`virtual_mouse(action="click", coordinate=[120, 50])`
- 用名稱操作：`click_element(name="Save")`

---

## UI Automation Control Patterns 參考

`click_element` / `type_into_element` 底層使用 UI Automation Control Patterns。當前已實現的和可擴展的：

| Pattern | 用途 | 當前狀態 | 可用於 |
|---------|------|---------|--------|
| `InvokePattern` | 觸發點擊 | ✅ 已實現 (`click_element`) | 按鈕、菜單項、連結 |
| `ValuePattern` | 讀寫文本值 | ✅ 已實現 (`type_into_element`) | 文本框、組合框 |
| `TogglePattern` | 切換狀態 | ❌ 未實現 | 複選框、開關 |
| `SelectionPattern` | 選擇專案 | ❌ 未實現 | 下拉菜單、列表 |
| `ScrollPattern` | 編程滾動 | ❌ 未實現（用 `mouse_wheel` 替代） | 列表、樹、面板 |
| `ExpandCollapsePattern` | 展開/摺疊 | ❌ 未實現 | 樹節點、摺疊面板 |
| `WindowPattern` | 窗口操作 | ❌ 未實現（用 `window_management` 替代） | 窗口最大化/關閉 |
| `TextPattern` | 讀取文件文本 | ❌ 未實現 | 文件、富文本 |
| `GridPattern` | 表格操作 | ❌ 未實現 | Excel 單元格、資料網格 |
| `TablePattern` | 表格結構 | ❌ 未實現 | 表頭、行列關係 |
| `RangeValuePattern` | 範圍值操作 | ❌ 未實現 | 滑塊、進度條 |
| `TransformPattern` | 移動/縮放 | ❌ 未實現 | 可拖拽元素 |

**擴展路線：** 優先實現 `TogglePattern`（複選框）和 `SelectionPattern`（下拉菜單），這兩個在表單自動化中最常用。

---

## 屏幕截取技術方案對比

當前使用 Python Bridge (mss) 進行截圖，底層是 GDI BitBlt。三種方案對比：

| 方案 | API | 當前狀態 | 性能 | 優勢 | 限制 |
|------|-----|---------|------|------|------|
| **GDI BitBlt** | `BitBlt` / `PrintWindow` | ✅ 當前使用 (mss/bridge.py) | ~300ms | 簡單穩定，支援後臺窗口 (PrintWindow) | 不支援硬件加速內容、DPI 處理複雜 |
| **DXGI Desktop Duplication** | `IDXGIOutputDuplication` | ❌ 未實現 | ~16ms (60fps) | 硬件加速，支援 HDR，GPU 直接讀取 | 不支援單窗口截取，需 D3D11 |
| **Windows.Graphics.Capture** | `GraphicsCaptureItem` | ❌ 未實現 | ~16ms | 最新 API，支援單窗口/單顯示器，系統級權限管理 | Win10 1903+，首次需用戶確認 |

### 推薦升級路徑

```
當前: GDI BitBlt (mss) ─── 全屏 ~300ms, 窗口 ~300ms (PrintWindow)
  │
  ├─ 近期: DXGI Desktop Duplication ─── 全屏 ~16ms, 但不支援單窗口
  │
  └─ 遠期: Windows.Graphics.Capture ─── 全屏 + 單窗口都 ~16ms
```

### DXGI Desktop Duplication 實現要點

```python
# bridge.py 中可添加 DXGI 截圖（通過 d3dshot 或 dxcam 庫）
import dxcam  # pip install dxcam

camera = dxcam.create()
frame = camera.grab()  # numpy array, ~5ms
# 轉爲 JPEG base64 發送
```

### Windows.Graphics.Capture 實現要點

```python
# 需要 WinRT Python 綁定
# pip install winrt-Windows.Graphics.Capture winrt-Windows.Graphics.DirectX
# 限制：首次呼叫需要用戶在系統彈窗中確認權限
```

---

## 輸入方式技術矩陣

不同應用類型需要不同的輸入方式：

| 輸入方式 | API | 優勢 | 限制 | 適用應用 |
|---------|-----|------|------|---------|
| **SendMessageW** | `WM_CHAR` / `WM_KEYDOWN` | 不搶焦點，不動真實鍵鼠 | 現代應用不支援 | Win32 傳統應用 (記事本/Office/WPF) |
| **SendInput** | `INPUT` 結構體 | 所有應用都支援 | **必須前臺焦點**，會干擾用戶 | 所有應用（通用後備） |
| **WriteConsoleInput** | 控制檯 API | 直接寫入控制檯緩衝區 | 需要 AttachConsole（可能被拒絕） | cmd/PowerShell（非 Windows Terminal） |
| **UI Automation** | `InvokePattern` / `ValuePattern` | 語義級操作，最可靠 | 部分應用不暴露 UIA 介面 | 支援 UIA 的應用 |
| **COM Automation** | Excel/Word COM | 完全編程控制 | 僅 Office 應用 | Excel / Word |
| **剪貼板 + 粘貼** | `SetClipboardData` + `Ctrl+V` | 繞過輸入限制 | 會覆蓋用戶剪貼板 | 通用後備 |

### 按應用類型的推薦輸入策略

| 應用類型 | 首選 | 後備 | 說明 |
|---------|------|------|------|
| 傳統 Win32 (記事本/寫字板) | SendMessageW | UIA ValuePattern | 虛擬輸入完美工作 |
| Office (Excel/Word) | COM Automation | SendMessageW | COM 提供結構化操作 |
| WPF 應用 | SendMessageW | UIA | 標準 Win32 訊息循環 |
| Electron/Chrome 應用 | UIA | 剪貼板粘貼 | 內部渲染不走 Win32 |
| Windows Terminal (ConPTY) | SendInput (需前臺) | 剪貼板粘貼 | ConPTY 不接受外部訊息 |
| UWP/WinUI 應用 | SendInput (需前臺) | UIA | XAML 渲染不走 Win32 訊息 |

---

## 已知限制與待解決

| 限制 | 影響 | 計劃 |
|------|------|------|
| Windows Terminal 不接受 SendMessageW | 虛擬鍵盤/鼠標對終端無效 | 自動檢測應用類型，終端類切換到 SendInput + 短暫激活 |
| PrintWindow 截不到 alternate screen buffer | Ink REPL 畫面截不到 | 切換到 Windows.Graphics.Capture |
| Accessibility Snapshot 對大應用慢 (>30s) | Excel 等複雜應用超時 | 限制遍歷深度 + 超時保護 |
| DWM 邊框對自定義標題欄應用可能無效 | 某些 Electron 應用看不到邊框 | 檢測並回退到疊加窗口方案 |
| 虛擬光標是 PowerShell WinForms 進程 | 啓動慢 (~1s)，資源佔用 | 考慮用 Win32 原生窗口替代 |

---

## 技術路線圖

### Phase 1（當前）— 基礎功能
- ✅ SendMessageW 虛擬輸入
- ✅ PrintWindow/mss 截圖
- ✅ UI Automation (InvokePattern + ValuePattern)
- ✅ Accessibility Snapshot
- ✅ DWM 邊框指示
- ✅ Python Bridge

### Phase 2（近期）— 相容性增強
- ⬜ 應用類型自動檢測（Win32 vs Terminal vs UWP）
- ⬜ 終端類應用自動切換 SendInput + 短暫激活
- ⬜ TogglePattern / SelectionPattern 支援
- ⬜ DXGI Desktop Duplication 高速截圖
- ⬜ Accessibility Snapshot 超時保護

### Phase 3（遠期）— 高級能力
- ⬜ Windows.Graphics.Capture（單窗口實時截圖）
- ⬜ 截圖元素標註（在截圖上標記 ID 數字）
- ⬜ 瀏覽器 DOM 提取（綁定瀏覽器時提取網頁結構）
- ⬜ GridPattern / TablePattern（Excel 單元格級操作）
- ⬜ TextPattern（檔案內容讀取）
- ⬜ 多窗口協同操作
