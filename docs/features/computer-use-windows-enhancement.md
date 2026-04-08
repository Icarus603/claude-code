# Computer Use Windows 增強實施計劃

更新時間：2026-04-03
依賴文件：`docs/features/windows-ai-desktop-control.md`、`docs/features/computer-use.md`

## 1. 目標

在已有的 PowerShell 子進程方案基礎上，利用 Windows 原生 API 增強 Computer Use 的 Windows 實現，解決 3 個核心問題：

1. **窗口綁定截圖**：當前 `CopyFromScreen` 只能全屏截圖，無法對指定窗口截圖（尤其是被遮擋/最小化窗口）
2. **UI 結構感知**：當前只能通過座標點擊，無法像 macOS Accessibility 那樣理解 UI 元素樹
3. **性能**：每次 PowerShell 啓動約 273ms，剪貼板/窗口枚舉等高頻操作需要更快的方式

## 2. 已驗證的 Windows API 能力

以下 API 全部通過 PowerShell P/Invoke 實測通過：

| 能力 | API | 驗證結果 |
|------|-----|---------|
| 窗口綁定截圖 | `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` | ✅ VS Code 342KB, Chrome 273KB |
| 枚舉窗口+HWND | `EnumWindows` + `GetWindowText` + `GetWindowThreadProcessId` | ✅ 38 個窗口，含 HWND/PID/標題 |
| UI 元素樹 | `System.Windows.Automation.AutomationElement` | ✅ 記事本 39 個元素 |
| UI 寫值 | `ValuePattern.SetValue()` | ✅ 成功寫入記事本文本 |
| UI 點擊 | `InvokePattern.Invoke()` | ✅ 按鈕可程式化點擊 |
| 座標元素識別 | `AutomationElement.FromPoint(x, y)` | ✅ 返回元素類型+名稱 |
| OCR | `Windows.Media.Ocr.OcrEngine` | ✅ 英語+中文引擎可用 |
| 全局熱鍵 | `RegisterHotKey` | ✅ API 可調 |
| 剪貼板直接操作 | `System.Windows.Forms.Clipboard` | ✅ 讀/寫/圖片檢測 |
| Shell 啓動 | `ShellExecute` | ✅ 打開文件/URL/應用 |

## 3. 架構設計

### 3.1 文件結構

在現有 `backends/win32.ts` 基礎上新增 Windows 專屬模組：

```
packages/@ant/computer-use-input/src/
├── backends/
│   ├── darwin.ts          ← 不動
│   ├── win32.ts           ← 增強：直接 Win32 API 替代部分 PowerShell
│   └── linux.ts           ← 不動

packages/@ant/computer-use-swift/src/
├── backends/
│   ├── darwin.ts          ← 不動
│   ├── win32.ts           ← 增強：PrintWindow 窗口截圖 + EnumWindows
│   └── linux.ts           ← 不動

packages/@ant/computer-use-mcp/src/
│   └── tools.ts           ← 增加 Windows 專屬工具定義（UI Automation、OCR）

src/utils/computerUse/
│   └── win32/              ← 新增目錄：Windows 專屬能力
│       ├── uiAutomation.ts  ← UI 元素樹、點擊、寫值
│       ├── ocr.ts           ← 截圖 + OCR 文字識別
│       ├── windowCapture.ts ← PrintWindow 窗口綁定截圖
│       └── windowEnum.ts    ← EnumWindows 窗口枚舉
```

### 3.2 分層

```
┌──────────────────────────────────────────────┐
│           Computer Use MCP Tools             │
│  screenshot / click / type / request_access  │
│  + Windows 專屬: ui_tree / ocr / window_cap  │
├──────────────────────────────────────────────┤
│           src/utils/computerUse/             │
│  executor.ts → 按平臺 dispatch               │
│  win32/ → Windows 專屬能力模組               │
├──────────────────────────────────────────────┤
│     packages/@ant/computer-use-{input,swift}  │
│  backends/win32.ts → PowerShell + Win32 API  │
├──────────────────────────────────────────────┤
│           Windows Native API                 │
│  PrintWindow / EnumWindows / UI Automation   │
│  SendInput / Clipboard / OCR / ShellExecute  │
└──────────────────────────────────────────────┘
```

## 4. 實施計劃

### Phase A：窗口綁定截圖（解決核心問題）

**問題**：當前 `CopyFromScreen` 只能全屏截圖，無法對指定窗口截圖。
**方案**：用 `PrintWindow` + `FindWindow` 實現窗口級截圖。

| 步驟 | 文件 | 改動 |
|------|------|------|
| A.1 | `src/utils/computerUse/win32/windowCapture.ts` | 新建：`captureWindow(title)` 用 PrintWindow 截取指定窗口 |
| A.2 | `src/utils/computerUse/win32/windowEnum.ts` | 新建：`listWindows()` 用 EnumWindows 返回 {hwnd, pid, title}[] |
| A.3 | `packages/@ant/computer-use-swift/src/backends/win32.ts` | `screenshot.captureExcluding` 增加按窗口截圖能力 |
| A.4 | `packages/@ant/computer-use-swift/src/backends/win32.ts` | `apps.listRunning` 用 EnumWindows 替代 Get-Process（返回 HWND） |

**PowerShell 腳本核心**：

```powershell
# PrintWindow 截取指定窗口
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @'
using System; using System.Runtime.InteropServices; using System.Drawing; using System.Drawing.Imaging;
public class WinCap {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern IntPtr FindWindow(string c, string t);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int L, T, R, B; }
    // ... CaptureByTitle(string title) → base64
}
'@
```

**驗證標準**：
- 能按窗口標題截圖
- 被遮擋的窗口也能截圖
- 返回 base64 + width + height

### Phase B：UI Automation（Windows 專屬新能力）

**問題**：macOS 有 Accessibility API 可以讀取/操作 UI 元素，Windows 當前只能座標點擊。
**方案**：用 `System.Windows.Automation` 實現 UI 樹讀取和元素操作。

| 步驟 | 文件 | 改動 |
|------|------|------|
| B.1 | `src/utils/computerUse/win32/uiAutomation.ts` | 新建：核心 UIA 操作封裝 |
| B.2 | `packages/@ant/computer-use-mcp/src/tools.ts` | 增加 Windows 專屬工具定義 |

**uiAutomation.ts 導出函數**：

```typescript
// 取得窗口的 UI 元素樹
getUITree(windowTitle: string, depth: number): UIElement[]

// 按名稱/類型/AutomationId 查找元素
findElement(windowTitle: string, query: {name?, controlType?, automationId?}): UIElement | null

// 點擊元素（InvokePattern）
clickElement(windowTitle: string, automationId: string): boolean

// 設置元素值（ValuePattern）
setValue(windowTitle: string, automationId: string, value: string): boolean

// 取得座標處的元素
elementAtPoint(x: number, y: number): UIElement | null
```

**UIElement 類型**：
```typescript
interface UIElement {
  name: string
  controlType: string    // Button, Edit, Text, List, etc.
  automationId: string
  boundingRect: { x: number, y: number, w: number, h: number }
  isEnabled: boolean
  value?: string         // ValuePattern 可用時
  children?: UIElement[]
}
```

**PowerShell 腳本核心**：
```powershell
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# 讀取 UI 樹
$root = [AutomationElement]::RootElement
$window = $root.FindFirst([TreeScope]::Children, 
  [PropertyCondition]::new([AutomationElement]::NameProperty, $title))
$elements = $window.FindAll([TreeScope]::Descendants, [Condition]::TrueCondition)

# 寫入文本
$element.GetCurrentPattern([ValuePattern]::Pattern).SetValue($text)

# 點擊按鈕
$element.GetCurrentPattern([InvokePattern]::Pattern).Invoke()
```

**驗證標準**：
- 能讀取記事本的 UI 樹（按鈕、文本框、菜單）
- 能向文本框寫入內容
- 能點擊按鈕
- 能識別座標處的元素

### Phase C：OCR 屏幕文字識別

**問題**：截圖後 AI 只能看到圖片，無法直接讀取文字。
**方案**：用 `Windows.Media.Ocr` 對截圖進行文字識別。

| 步驟 | 文件 | 改動 |
|------|------|------|
| C.1 | `src/utils/computerUse/win32/ocr.ts` | 新建：截圖 + OCR 識別 |
| C.2 | `packages/@ant/computer-use-mcp/src/tools.ts` | 增加 `screen_ocr` 工具定義 |

**ocr.ts 導出函數**：
```typescript
// 對屏幕區域 OCR
ocrRegion(x: number, y: number, w: number, h: number, lang?: string): OcrResult

// 對指定窗口 OCR
ocrWindow(windowTitle: string, lang?: string): OcrResult

interface OcrResult {
  text: string
  lines: { text: string, bounds: {x,y,w,h} }[]
  language: string
}
```

**已確認可用語言**：英語 (en-US) + 中文 (zh-Hans-CN)

**驗證標準**：
- 能識別屏幕區域中的英文和中文
- 返回文字內容 + 每行的位置信息

### Phase D：高頻操作性能優化

**問題**：每次 PowerShell 啓動 273ms，鼠標移動等高頻操作太慢。
**方案**：用 .NET `System.Windows.Forms.Clipboard` 等直接 API 替代 PowerShell 子進程。

| 步驟 | 文件 | 改動 |
|------|------|------|
| D.1 | `src/utils/computerUse/executor.ts` | 剪貼板操作用直接 API 替代 PowerShell |
| D.2 | 考慮駐留 PowerShell 進程 | 通過 stdin/stdout 交互，攤平啓動成本 |

**剪貼板直接 API**（不需要 PowerShell 子進程）：
```powershell
# 讀：50ms → <1ms
[System.Windows.Forms.Clipboard]::GetText()

# 寫：50ms → <1ms  
[System.Windows.Forms.Clipboard]::SetText($text)

# 圖片檢測
[System.Windows.Forms.Clipboard]::ContainsImage()
```

### Phase E：`request_access` Windows 適配

**問題**：`request_access` 依賴 macOS bundleId 識別應用，Windows 沒有這個概念。
**方案**：在 Windows 上用 exe 路徑 + 窗口標題替代 bundleId。

| 步驟 | 文件 | 改動 |
|------|------|------|
| E.1 | `packages/@ant/computer-use-mcp/src/toolCalls.ts` | `resolveRequestedApps` 在 Windows 上用 exe 路徑匹配 |
| E.2 | `packages/@ant/computer-use-mcp/src/sentinelApps.ts` | 增加 Windows 危險應用列表（cmd.exe, powershell.exe 等） |
| E.3 | `packages/@ant/computer-use-mcp/src/deniedApps.ts` | 增加 Windows 瀏覽器/終端識別規則 |
| E.4 | `src/utils/computerUse/hostAdapter.ts` | `ensureOsPermissions` Windows 上檢查 UAC 狀態 |

**Windows 應用標識映射**：
```
macOS bundleId          →  Windows 等價
com.apple.Safari        →  C:\Program Files\...\msedge.exe（或窗口標題匹配）
com.google.Chrome       →  chrome.exe
com.apple.Terminal      →  WindowsTerminal.exe / cmd.exe
```

### Phase F：全局熱鍵（ESC 攔截）

**問題**：當前非 darwin 直接跳過 ESC 熱鍵，用 Ctrl+C 替代。
**方案**：用 `RegisterHotKey` 或 `SetWindowsHookEx(WH_KEYBOARD_LL)` 實現。

| 步驟 | 文件 | 改動 |
|------|------|------|
| F.1 | `src/utils/computerUse/escHotkey.ts` | Windows 分支：RegisterHotKey 註冊 ESC |

**優先級低**——當前 Ctrl+C fallback 可用，ESC 熱鍵是體驗優化。

## 5. 執行優先級

```
Phase A: 窗口綁定截圖          ← P0 核心需求，解決"操作其他界面"
Phase B: UI Automation         ← P0 核心能力，AI 理解 UI 結構
Phase C: OCR                   ← P1 增值能力，AI 讀屏幕文字
Phase D: 性能優化              ← P1 體驗優化，高頻操作提速
Phase E: request_access 適配   ← P1 功能完整性，權限模型適配
Phase F: ESC 熱鍵              ← P2 體驗優化，可後做
```

## 6. 每個 Phase 的改動量估算

| Phase | 新增文件 | 修改文件 | 新增程式碼行 | 風險 |
|-------|---------|---------|-----------|------|
| A 窗口截圖 | 2 | 1 | ~200 | 低 |
| B UI Automation | 1 | 1 | ~300 | 中 |
| C OCR | 1 | 1 | ~150 | 低 |
| D 性能優化 | 0 | 2 | ~50 | 低 |
| E request_access | 0 | 3 | ~100 | 中 |
| F ESC 熱鍵 | 0 | 1 | ~50 | 低 |
| **總計** | **4** | **9** | **~850** | — |

## 7. 不動的文件

- `backends/darwin.ts`（兩個包都不動）
- `backends/linux.ts`（兩個包都不動）
- `src/utils/computerUse/` 中 macOS 相關程式碼路徑不動
- `packages/@ant/computer-use-mcp/src/` 中已複製的參考專案程式碼不動（只追加 Windows 工具）

## 8. 與 macOS/Linux 方案的對比

| 能力 | macOS | Windows (增強後) | Linux |
|------|-------|-----------------|-------|
| 截圖方式 | SCContentFilter (per-app) | **PrintWindow (per-window)** | scrot (全屏/區域) |
| UI 結構 | Accessibility API | **UI Automation** | 無 |
| OCR | 無內置 | **Windows.Media.Ocr** | 無內置 |
| 鍵鼠 | CGEvent + enigo | SendInput + keybd_event | xdotool |
| 窗口管理 | NSWorkspace | **EnumWindows + Win32** | wmctrl |
| 剪貼板 | pbcopy/pbpaste | **Clipboard 直接 API** | xclip |
| ESC 熱鍵 | CGEventTap | RegisterHotKey | 無 |
| 應用標識 | bundleId | exe 路徑 + 窗口標題 | /proc + wmctrl |

**Windows 增強後將在 UI Automation 和 OCR 方面超過 macOS 方案**——這兩項 macOS 原始實現也沒有（Anthropic 用的是截圖 + Claude 視覺理解，沒有結構化 UI 資料）。
