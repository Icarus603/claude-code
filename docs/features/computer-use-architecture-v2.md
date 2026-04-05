# Computer Use 架构修正方案 v2

更新时间：2026-04-04

## 1. 当前架构的问题

### 问题 A：平台代码混在错误的包里

`@ant/computer-use-swift` 是 macOS Swift 原生模块的包装器，但我们把 Windows（`backends/win32.ts`）和 Linux（`backends/linux.ts`）的截图/应用管理代码塞进了这个包。"swift" 在名字里就意味着 macOS，后期维护者无法区分。

`@ant/computer-use-input` 同样——原本是 macOS enigo Rust 模块，我们也往里面塞了 win32/linux 后端。

### 问题 B：输入方式不对

当前 Windows 后端（`packages/@ant/computer-use-input/src/backends/win32.ts`）使用 `SetCursorPos` + `SendInput` + `keybd_event`——这是**全局输入**：

- 鼠标真的会移动到屏幕上
- 键盘真的打到当前前台窗口
- **会影响用户当前的操作**

绑定窗口句柄后，应该用 `SendMessage`/`PostMessage` 向目标 HWND 发送消息：

- `WM_CHAR` — 发送字符，不移动光标
- `WM_KEYDOWN`/`WM_KEYUP` — 发送按键
- `WM_LBUTTONDOWN`/`WM_LBUTTONUP` — 发送鼠标点击（窗口客户区相对坐标）
- `PrintWindow` — 截取窗口内容，不需要窗口在前台
- **不抢焦点、不影响用户当前操作**

已验证：向记事本 `SendMessage(WM_CHAR)` 成功写入文字，记事本在后台，终端保持前台。

### 问题 C：截图是公共能力，不属于 swift

截图（screenshot）、显示器枚举（display）、应用管理（apps）是所有平台都需要的公共能力，不应该放在 `@ant/computer-use-swift`（macOS 专属包名）里。

## 2. 修正后的架构

### 2.1 分层原则

```
packages/@ant/                     ← macOS 原生模块包装器（不放其他平台代码）
├── computer-use-input/             ← macOS: enigo .node 键鼠（仅 darwin）
├── computer-use-swift/             ← macOS: Swift .node 截图/应用（仅 darwin）
└── computer-use-mcp/               ← 跨平台: MCP server + 工具定义（不改）

src/utils/computerUse/
├── platforms/                     ← 新增: 跨平台抽象层
│   ├── types.ts                    ← 公共接口: InputPlatform, ScreenshotPlatform, AppsPlatform, DisplayPlatform
│   ├── index.ts                    ← 平台分发器: 按 process.platform 加载后端
│   ├── darwin.ts                   ← macOS: 委托给 @ant/computer-use-{input,swift}
│   ├── win32.ts                    ← Windows: SendMessage 输入 + PrintWindow 截图 + EnumWindows + UIA + OCR
│   └── linux.ts                    ← Linux: xdotool + scrot + xrandr + wmctrl
│
├── win32/                         ← Windows 专属增强能力（不在公共接口中）
│   ├── windowCapture.ts            ← PrintWindow 窗口绑定截图
│   ├── windowEnum.ts               ← EnumWindows 窗口枚举
│   ├── windowMessage.ts            ← SendMessage/PostMessage 无焦点输入（新增）
│   ├── uiAutomation.ts             ← IUIAutomation UI 元素操作
│   └── ocr.ts                      ← Windows.Media.Ocr 文字识别
│
├── executor.ts                    ← 改: 通过 platforms/ 获取平台实现，不直接调 @ant 包
├── swiftLoader.ts                 ← 改: 仅 darwin 使用
├── inputLoader.ts                 ← 改: 仅 darwin 使用
└── ...其他文件不动
```

### 2.2 公共接口（`platforms/types.ts`）

```typescript
/** 窗口标识 — 跨平台 */
export interface WindowHandle {
  id: string           // macOS: bundleId, Windows: HWND string, Linux: window ID
  pid: number
  title: string
  exePath?: string     // Windows/Linux: 进程路径
}

/** 输入平台接口 — 两种模式 */
export interface InputPlatform {
  // 模式 A: 全局输入（macOS/Linux 默认，向前台窗口发送）
  moveMouse(x: number, y: number): Promise<void>
  click(x: number, y: number, button: 'left' | 'right' | 'middle'): Promise<void>
  typeText(text: string): Promise<void>
  key(name: string, action: 'press' | 'release'): Promise<void>
  keys(combo: string[]): Promise<void>
  scroll(amount: number, direction: 'vertical' | 'horizontal'): Promise<void>
  mouseLocation(): Promise<{ x: number; y: number }>
  
  // 模式 B: 窗口绑定输入（Windows SendMessage，不抢焦点）
  sendChar?(hwnd: string, char: string): Promise<void>
  sendKey?(hwnd: string, vk: number, action: 'down' | 'up'): Promise<void>
  sendClick?(hwnd: string, x: number, y: number, button: 'left' | 'right'): Promise<void>
  sendText?(hwnd: string, text: string): Promise<void>
}

/** 截图平台接口 */
export interface ScreenshotPlatform {
  // 全屏截图
  captureScreen(displayId?: number): Promise<ScreenshotResult>
  // 区域截图
  captureRegion(x: number, y: number, w: number, h: number): Promise<ScreenshotResult>
  // 窗口截图（Windows: PrintWindow，macOS: SCContentFilter，Linux: xdotool+import）
  captureWindow?(hwnd: string): Promise<ScreenshotResult | null>
}

/** 显示器平台接口 */
export interface DisplayPlatform {
  listAll(): DisplayInfo[]
  getSize(displayId?: number): DisplayInfo
}

/** 应用管理平台接口 */
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

### 2.3 平台分发器（`platforms/index.ts`）

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

### 2.4 各平台实现

**`platforms/darwin.ts`** — 委托给 @ant 包（保持兼容）：
```typescript
// macOS: 通过 @ant/computer-use-input 和 @ant/computer-use-swift
// 这两个包的 darwin 后端保留不动
import { requireComputerUseInput } from '../inputLoader.js'
import { requireComputerUseSwift } from '../swiftLoader.js'

export const platform = {
  input: { /* 委托给 requireComputerUseInput() */ },
  screenshot: { /* 委托给 requireComputerUseSwift().screenshot */ },
  display: { /* 委托给 requireComputerUseSwift().display */ },
  apps: { /* 委托给 requireComputerUseSwift().apps */ },
}
```

**`platforms/win32.ts`** — 使用 `src/utils/computerUse/win32/` 模块：
```typescript
// Windows: SendMessage 输入 + PrintWindow 截图 + EnumWindows 应用
import { sendChar, sendKey, sendClick, sendText } from '../win32/windowMessage.js'
import { captureWindow } from '../win32/windowCapture.js'
import { listWindows } from '../win32/windowEnum.js'
// ... PowerShell P/Invoke 全局输入作为 fallback

export const platform = {
  input: {
    // 全局模式: PowerShell SetCursorPos/SendInput（fallback）
    // 窗口模式: SendMessage（首选）
    sendChar, sendKey, sendClick, sendText,  // 窗口绑定
    moveMouse, click, typeText, ...           // 全局 fallback
  },
  screenshot: {
    captureScreen,     // CopyFromScreen
    captureRegion,     // CopyFromScreen(rect)
    captureWindow,     // PrintWindow（不抢焦点）
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
// 之前: 直接调 requireComputerUseSwift() 和 requireComputerUseInput()
// 之后: 通过 platforms/ 统一获取

import { loadPlatform } from './platforms/index.js'

const platform = loadPlatform()

// 截图
platform.screenshot.captureScreen()
platform.screenshot.captureWindow(hwnd)  // 窗口绑定

// 输入（窗口绑定模式，不抢焦点）
platform.input.sendText?.(hwnd, 'Hello')
platform.input.sendClick?.(hwnd, 100, 200, 'left')

// 输入（全局模式，fallback）
platform.input.moveMouse(500, 500)
platform.input.click(500, 500, 'left')
```

## 3. Windows 输入模式对比

| 方式 | API | 抢焦点 | 移鼠标 | 窗口可最小化 | 适用场景 |
|------|-----|--------|--------|-------------|---------|
| **全局输入** | `SetCursorPos` + `SendInput` | ✅ 抢 | ✅ 动 | ❌ 不行 | 需要坐标点击（fallback） |
| **窗口消息** | `SendMessage(WM_CHAR/WM_KEYDOWN)` | ❌ 不抢 | ❌ 不动 | ✅ 可以 | 打字、按键（首选） |
| **窗口消息** | `SendMessage(WM_LBUTTONDOWN)` | ❌ 不抢 | ❌ 不动 | ⚠️ 部分 | 窗口内点击 |
| **窗口截图** | `PrintWindow(hwnd, PW_RENDERFULLCONTENT)` | ❌ 不抢 | ❌ 不动 | ✅ 可以 | 窗口截图 |
| **UI 操作** | `UIAutomation InvokePattern` | ❌ 不抢 | ❌ 不动 | ✅ 可以 | 按钮点击、文本写入 |

**策略**：优先用窗口消息 + UIAutomation（不干扰用户），全局输入作为 fallback。

## 4. 需要新增的文件

| 文件 | 说明 |
|------|------|
| `src/utils/computerUse/platforms/types.ts` | 公共接口定义 |
| `src/utils/computerUse/platforms/index.ts` | 平台分发器 |
| `src/utils/computerUse/platforms/darwin.ts` | macOS: 委托给 @ant 包 |
| `src/utils/computerUse/platforms/win32.ts` | Windows: 组合 win32/ 下各模块 |
| `src/utils/computerUse/platforms/linux.ts` | Linux: xdotool/scrot |
| `src/utils/computerUse/win32/windowMessage.ts` | **新增**: SendMessage 无焦点输入 |

## 5. 需要移除/清理的文件

| 文件 | 操作 | 原因 |
|------|------|------|
| `packages/@ant/computer-use-input/src/backends/win32.ts` | 删除 | Windows 代码不应在 macOS 包里 |
| `packages/@ant/computer-use-input/src/backends/linux.ts` | 删除 | Linux 代码不应在 macOS 包里 |
| `packages/@ant/computer-use-swift/src/backends/win32.ts` | 删除 | 同上 |
| `packages/@ant/computer-use-swift/src/backends/linux.ts` | 删除 | 同上 |
| `packages/@ant/computer-use-input/src/types.ts` | 删除 | 移到 platforms/types.ts |
| `packages/@ant/computer-use-swift/src/types.ts` | 删除 | 移到 platforms/types.ts |

## 6. 需要修改的文件

| 文件 | 改动 |
|------|------|
| `packages/@ant/computer-use-input/src/index.ts` | 恢复为仅 darwin dispatcher（去掉 win32/linux case） |
| `packages/@ant/computer-use-swift/src/index.ts` | 恢复为仅 darwin dispatcher（去掉 win32/linux case） |
| `src/utils/computerUse/executor.ts` | 通过 `platforms/` 获取平台实现，不直接调 @ant 包 |
| `src/utils/computerUse/swiftLoader.ts` | 仅 darwin 加载 |
| `src/utils/computerUse/inputLoader.ts` | 仅 darwin 加载 |

## 7. @ant 包的定位（修正后）

| 包 | 职责 | 平台 |
|---|------|------|
| `@ant/computer-use-input` | macOS enigo 键鼠原生模块包装 | **仅 darwin** |
| `@ant/computer-use-swift` | macOS Swift 截图/应用原生模块包装 | **仅 darwin** |
| `@ant/computer-use-mcp` | MCP Server + 工具定义 + 调用路由 | **跨平台**（不含平台代码） |

Windows/Linux 的平台实现全部在 `src/utils/computerUse/platforms/` 和 `src/utils/computerUse/win32/` 中。

## 8. 执行顺序

```
Phase 1: 创建 platforms/ 抽象层
  ├── platforms/types.ts（公共接口）
  ├── platforms/index.ts（分发器）
  └── platforms/darwin.ts（委托 @ant 包）

Phase 2: 创建 Windows 平台实现
  ├── win32/windowMessage.ts（SendMessage 无焦点输入）
  └── platforms/win32.ts（组合 win32/ 各模块）

Phase 3: 创建 Linux 平台实现
  └── platforms/linux.ts（xdotool/scrot）

Phase 4: 改造 executor.ts
  └── 通过 platforms/ 获取实现，不直接调 @ant

Phase 5: 清理 @ant 包
  ├── 删除 @ant/computer-use-input/src/backends/{win32,linux}.ts
  ├── 删除 @ant/computer-use-swift/src/backends/{win32,linux}.ts
  └── 恢复 index.ts 为 darwin-only

Phase 6: 验证 + PR
```
