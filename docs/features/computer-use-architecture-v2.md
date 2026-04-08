# Computer Use 架構修正方案 v2

更新時間：2026-04-04

## 1. 當前架構的問題

### 問題 A：平臺程式碼混在錯誤的包裏

`@ant/computer-use-swift` 是 macOS Swift 原生模組的包裝器，但我們把 Windows（`backends/win32.ts`）和 Linux（`backends/linux.ts`）的截圖/應用管理程式碼塞進了這個包。"swift" 在名字裏就意味着 macOS，後期維護者無法區分。

`@ant/computer-use-input` 同樣——原本是 macOS enigo Rust 模組，我們也往裏面塞了 win32/linux 後端。

### 問題 B：輸入方式不對

當前 Windows 後端（`packages/@ant/computer-use-input/src/backends/win32.ts`）使用 `SetCursorPos` + `SendInput` + `keybd_event`——這是**全局輸入**：

- 鼠標真的會移動到屏幕上
- 鍵盤真的打到當前前臺窗口
- **會影響用戶當前的操作**

綁定窗口句柄後，應該用 `SendMessage`/`PostMessage` 向目標 HWND 發送訊息：

- `WM_CHAR` — 發送字符，不移動光標
- `WM_KEYDOWN`/`WM_KEYUP` — 發送按鍵
- `WM_LBUTTONDOWN`/`WM_LBUTTONUP` — 發送鼠標點擊（窗口客戶區相對座標）
- `PrintWindow` — 截取窗口內容，不需要窗口在前臺
- **不搶焦點、不影響用戶當前操作**

已驗證：向記事本 `SendMessage(WM_CHAR)` 成功寫入文字，記事本在後臺，終端保持前臺。

### 問題 C：截圖是公共能力，不屬於 swift

截圖（screenshot）、顯示器枚舉（display）、應用管理（apps）是所有平臺都需要的公共能力，不應該放在 `@ant/computer-use-swift`（macOS 專屬包名）裏。

## 2. 修正後的架構

### 2.1 分層原則

```
packages/@ant/                     ← macOS 原生模組包裝器（不放其他平臺程式碼）
├── computer-use-input/             ← macOS: enigo .node 鍵鼠（僅 darwin）
├── computer-use-swift/             ← macOS: Swift .node 截圖/應用（僅 darwin）
└── computer-use-mcp/               ← 跨平臺: MCP server + 工具定義（不改）

src/utils/computerUse/
├── platforms/                     ← 新增: 跨平臺抽象層
│   ├── types.ts                    ← 公共介面: InputPlatform, ScreenshotPlatform, AppsPlatform, DisplayPlatform
│   ├── index.ts                    ← 平臺分發器: 按 process.platform 加載後端
│   ├── darwin.ts                   ← macOS: 委託給 @ant/computer-use-{input,swift}
│   ├── win32.ts                    ← Windows: SendMessage 輸入 + PrintWindow 截圖 + EnumWindows + UIA + OCR
│   └── linux.ts                    ← Linux: xdotool + scrot + xrandr + wmctrl
│
├── win32/                         ← Windows 專屬增強能力（不在公共介面中）
│   ├── windowCapture.ts            ← PrintWindow 窗口綁定截圖
│   ├── windowEnum.ts               ← EnumWindows 窗口枚舉
│   ├── windowMessage.ts            ← SendMessage/PostMessage 無焦點輸入（新增）
│   ├── uiAutomation.ts             ← IUIAutomation UI 元素操作
│   └── ocr.ts                      ← Windows.Media.Ocr 文字識別
│
├── executor.ts                    ← 改: 通過 platforms/ 取得平臺實現，不直接調 @ant 包
├── swiftLoader.ts                 ← 改: 僅 darwin 使用
├── inputLoader.ts                 ← 改: 僅 darwin 使用
└── ...其他文件不動
```

### 2.2 公共介面（`platforms/types.ts`）

```typescript
/** 窗口標識 — 跨平臺 */
export interface WindowHandle {
  id: string           // macOS: bundleId, Windows: HWND string, Linux: window ID
  pid: number
  title: string
  exePath?: string     // Windows/Linux: 進程路徑
}

/** 輸入平臺介面 — 兩種模式 */
export interface InputPlatform {
  // 模式 A: 全局輸入（macOS/Linux 預設，向前臺窗口發送）
  moveMouse(x: number, y: number): Promise<void>
  click(x: number, y: number, button: 'left' | 'right' | 'middle'): Promise<void>
  typeText(text: string): Promise<void>
  key(name: string, action: 'press' | 'release'): Promise<void>
  keys(combo: string[]): Promise<void>
  scroll(amount: number, direction: 'vertical' | 'horizontal'): Promise<void>
  mouseLocation(): Promise<{ x: number; y: number }>
  
  // 模式 B: 窗口綁定輸入（Windows SendMessage，不搶焦點）
  sendChar?(hwnd: string, char: string): Promise<void>
  sendKey?(hwnd: string, vk: number, action: 'down' | 'up'): Promise<void>
  sendClick?(hwnd: string, x: number, y: number, button: 'left' | 'right'): Promise<void>
  sendText?(hwnd: string, text: string): Promise<void>
}

/** 截圖平臺介面 */
export interface ScreenshotPlatform {
  // 全屏截圖
  captureScreen(displayId?: number): Promise<ScreenshotResult>
  // 區域截圖
  captureRegion(x: number, y: number, w: number, h: number): Promise<ScreenshotResult>
  // 窗口截圖（Windows: PrintWindow，macOS: SCContentFilter，Linux: xdotool+import）
  captureWindow?(hwnd: string): Promise<ScreenshotResult | null>
}

/** 顯示器平臺介面 */
export interface DisplayPlatform {
  listAll(): DisplayInfo[]
  getSize(displayId?: number): DisplayInfo
}

/** 應用管理平臺介面 */
export interface AppsPlatform {
  listRunning(): WindowHandle[]
  listInstalled(): Promise<InstalledApp[]>
  open(name: string): Promise<void>
  getFrontmostApp(): FrontmostAppInfo | null
  findWindowByTitle(title: string): WindowHandle | null
}

export interface ScreenshotResult {
  base64: string
  width: number
  height: number
}

export interface DisplayInfo {
  width: number
  height: number
  scaleFactor: number
  displayId: number
}

export interface InstalledApp {
  id: string       // macOS: bundleId, Windows: exe path, Linux: .desktop name
  displayName: string
  path: string
}

export interface FrontmostAppInfo {
  id: string
  appName: string
}
```

### 2.3 平臺分發器（`platforms/index.ts`）

```typescript
import type { InputPlatform, ScreenshotPlatform, DisplayPlatform, AppsPlatform } from './types.js'

export interface Platform {
  input: InputPlatform
  screenshot: ScreenshotPlatform
  display: DisplayPlatform
  apps: AppsPlatform
}

export function loadPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return require('./darwin.js').platform
    case 'win32':
      return require('./win32.js').platform
    case 'linux':
      return require('./linux.js').platform
    default:
      throw new Error(`Computer Use not supported on ${process.platform}`)
  }
}
```

### 2.4 各平臺實現

**`platforms/darwin.ts`** — 委託給 @ant 包（保持相容）：
```typescript
// macOS: 通過 @ant/computer-use-input 和 @ant/computer-use-swift
// 這兩個包的 darwin 後端保留不動
import { requireComputerUseInput } from '../inputLoader.js'
import { requireComputerUseSwift } from '../swiftLoader.js'

export const platform = {
  input: { /* 委託給 requireComputerUseInput() */ },
  screenshot: { /* 委託給 requireComputerUseSwift().screenshot */ },
  display: { /* 委託給 requireComputerUseSwift().display */ },
  apps: { /* 委託給 requireComputerUseSwift().apps */ },
}
```

**`platforms/win32.ts`** — 使用 `src/utils/computerUse/win32/` 模組：
```typescript
// Windows: SendMessage 輸入 + PrintWindow 截圖 + EnumWindows 應用
import { sendChar, sendKey, sendClick, sendText } from '../win32/windowMessage.js'
import { captureWindow } from '../win32/windowCapture.js'
import { listWindows } from '../win32/windowEnum.js'
// ... PowerShell P/Invoke 全局輸入作爲 fallback

export const platform = {
  input: {
    // 全局模式: PowerShell SetCursorPos/SendInput（fallback）
    // 窗口模式: SendMessage（首選）
    sendChar, sendKey, sendClick, sendText,  // 窗口綁定
    moveMouse, click, typeText, ...           // 全局 fallback
  },
  screenshot: {
    captureScreen,     // CopyFromScreen
    captureRegion,     // CopyFromScreen(rect)
    captureWindow,     // PrintWindow（不搶焦點）
  },
  display: { /* Screen.AllScreens */ },
  apps: { /* EnumWindows */ },
}
```

**`platforms/linux.ts`** — 使用 xdotool/scrot：
```typescript
// Linux: xdotool + scrot + xrandr + wmctrl
export const platform = {
  input: { /* xdotool mousemove/click/key/type */ },
  screenshot: { /* scrot */ },
  display: { /* xrandr */ },
  apps: { /* wmctrl + ps */ },
}
```

### 2.5 executor.ts 改造

```typescript
// 之前: 直接調 requireComputerUseSwift() 和 requireComputerUseInput()
// 之後: 通過 platforms/ 統一取得

import { loadPlatform } from './platforms/index.js'

const platform = loadPlatform()

// 截圖
platform.screenshot.captureScreen()
platform.screenshot.captureWindow(hwnd)  // 窗口綁定

// 輸入（窗口綁定模式，不搶焦點）
platform.input.sendText?.(hwnd, 'Hello')
platform.input.sendClick?.(hwnd, 100, 200, 'left')

// 輸入（全局模式，fallback）
platform.input.moveMouse(500, 500)
platform.input.click(500, 500, 'left')
```

## 3. Windows 輸入模式對比

| 方式 | API | 搶焦點 | 移鼠標 | 窗口可最小化 | 適用場景 |
|------|-----|--------|--------|-------------|---------|
| **全局輸入** | `SetCursorPos` + `SendInput` | ✅ 搶 | ✅ 動 | ❌ 不行 | 需要座標點擊（fallback） |
| **窗口訊息** | `SendMessage(WM_CHAR/WM_KEYDOWN)` | ❌ 不搶 | ❌ 不動 | ✅ 可以 | 打字、按鍵（首選） |
| **窗口訊息** | `SendMessage(WM_LBUTTONDOWN)` | ❌ 不搶 | ❌ 不動 | ⚠️ 部分 | 窗口內點擊 |
| **窗口截圖** | `PrintWindow(hwnd, PW_RENDERFULLCONTENT)` | ❌ 不搶 | ❌ 不動 | ✅ 可以 | 窗口截圖 |
| **UI 操作** | `UIAutomation InvokePattern` | ❌ 不搶 | ❌ 不動 | ✅ 可以 | 按鈕點擊、文本寫入 |

**策略**：優先用窗口訊息 + UIAutomation（不幹擾用戶），全局輸入作爲 fallback。

## 4. 需要新增的文件

| 文件 | 說明 |
|------|------|
| `src/utils/computerUse/platforms/types.ts` | 公共介面定義 |
| `src/utils/computerUse/platforms/index.ts` | 平臺分發器 |
| `src/utils/computerUse/platforms/darwin.ts` | macOS: 委託給 @ant 包 |
| `src/utils/computerUse/platforms/win32.ts` | Windows: 組合 win32/ 下各模組 |
| `src/utils/computerUse/platforms/linux.ts` | Linux: xdotool/scrot |
| `src/utils/computerUse/win32/windowMessage.ts` | **新增**: SendMessage 無焦點輸入 |

## 5. 需要移除/清理的文件

| 文件 | 操作 | 原因 |
|------|------|------|
| `packages/@ant/computer-use-input/src/backends/win32.ts` | 刪除 | Windows 程式碼不應在 macOS 包裏 |
| `packages/@ant/computer-use-input/src/backends/linux.ts` | 刪除 | Linux 程式碼不應在 macOS 包裏 |
| `packages/@ant/computer-use-swift/src/backends/win32.ts` | 刪除 | 同上 |
| `packages/@ant/computer-use-swift/src/backends/linux.ts` | 刪除 | 同上 |
| `packages/@ant/computer-use-input/src/types.ts` | 刪除 | 移到 platforms/types.ts |
| `packages/@ant/computer-use-swift/src/types.ts` | 刪除 | 移到 platforms/types.ts |

## 6. 需要修改的文件

| 文件 | 改動 |
|------|------|
| `packages/@ant/computer-use-input/src/index.ts` | 恢復爲僅 darwin dispatcher（去掉 win32/linux case） |
| `packages/@ant/computer-use-swift/src/index.ts` | 恢復爲僅 darwin dispatcher（去掉 win32/linux case） |
| `src/utils/computerUse/executor.ts` | 通過 `platforms/` 取得平臺實現，不直接調 @ant 包 |
| `src/utils/computerUse/swiftLoader.ts` | 僅 darwin 加載 |
| `src/utils/computerUse/inputLoader.ts` | 僅 darwin 加載 |

## 7. @ant 包的定位（修正後）

| 包 | 職責 | 平臺 |
|---|------|------|
| `@ant/computer-use-input` | macOS enigo 鍵鼠原生模組包裝 | **僅 darwin** |
| `@ant/computer-use-swift` | macOS Swift 截圖/應用原生模組包裝 | **僅 darwin** |
| `@ant/computer-use-mcp` | MCP Server + 工具定義 + 呼叫路由 | **跨平臺**（不含平臺程式碼） |

Windows/Linux 的平臺實現全部在 `src/utils/computerUse/platforms/` 和 `src/utils/computerUse/win32/` 中。

## 8. 執行順序

```
Phase 1: 建立 platforms/ 抽象層
  ├── platforms/types.ts（公共介面）
  ├── platforms/index.ts（分發器）
  └── platforms/darwin.ts（委託 @ant 包）

Phase 2: 建立 Windows 平臺實現
  ├── win32/windowMessage.ts（SendMessage 無焦點輸入）
  └── platforms/win32.ts（組合 win32/ 各模組）

Phase 3: 建立 Linux 平臺實現
  └── platforms/linux.ts（xdotool/scrot）

Phase 4: 改造 executor.ts
  └── 通過 platforms/ 取得實現，不直接調 @ant

Phase 5: 清理 @ant 包
  ├── 刪除 @ant/computer-use-input/src/backends/{win32,linux}.ts
  ├── 刪除 @ant/computer-use-swift/src/backends/{win32,linux}.ts
  └── 恢復 index.ts 爲 darwin-only

Phase 6: 驗證 + PR
```
