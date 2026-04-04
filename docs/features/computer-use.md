# Computer Use — macOS / Windows / Linux 跨平台实施计划

更新时间：2026-04-04
参考项目：https://github.com/JrCx7scC/claude-code-source

## 1. 现状

参考项目的 Computer Use **仅支持 macOS**——从入口到底层全部写死 darwin。我们的项目在 Phase 1-3 中已经完成了：

- ✅ `@ant/computer-use-mcp` stub 替换为完整实现（12 文件）
- ✅ `@ant/computer-use-input` 拆为 dispatcher + backends（darwin + win32）
- ✅ `@ant/computer-use-swift` 拆为 dispatcher + backends（darwin + win32）
- ✅ `CHICAGO_MCP` 编译开关已开
- ✅ `src/` 层 macOS 硬编码全部移除，已支持 darwin / win32 / linux 三平台

## 2. 用户使用方式

Computer Use 由 `CHICAGO_MCP` feature flag 控制，无需额外 CLI 参数。

> **订阅要求**：需要 Claude Pro、Max 或 Team 订阅，Computer Use 功能不向免费用户开放。

### Dev 模式（默认已开启）

```bash
bun run dev
```

`scripts/dev.ts` 的默认 feature 列表已包含 `CHICAGO_MCP`，启动后自动注册 Computer Use MCP 工具。

### 构建产物

```bash
FEATURE_CHICAGO_MCP=1 node dist/cli.js
```

### 使用流程

1. **启动 CLI** — `bun run dev`（或构建产物 + 环境变量）
2. **正常对话** — 在 REPL 中与 Claude 对话，当你让 Claude 操作电脑时（如"帮我打开浏览器并访问 xxx"），Claude 会调用 Computer Use 工具
3. **首次审批** — Claude 首次尝试操控某个 App 时，会弹出权限对话框，你需要确认允许哪些 App 被操控（可勾选"本次会话不再询问"）
4. **操作中** — 系统会发送通知"Claude is using your computer"，macOS 按 Esc、其他平台按 Ctrl+C 可中止
5. **操作结束** — Claude 完成操作后自动释放，被隐藏的窗口会自动恢复

### 可用的操作

- 截图（全屏 / 区域缩放）
- 鼠标移动、点击、拖拽、滚轮
- 键盘输入、组合键、长按
- 通过剪贴板粘贴多行文本
- 应用管理（列出、打开、隐藏/恢复）
- 多显示器支持（自动选择或手动指定）

### Linux 依赖工具

| 工具 | 用途 | 安装命令（Ubuntu） |
|------|------|-------------------|
| `xdotool` | 键鼠模拟 + 窗口管理 | `sudo apt install xdotool` |
| `scrot` 或 `gnome-screenshot` | 截图 | `sudo apt install scrot` |
| `xrandr` | 显示器信息 | 通常已预装 |
| `xclip` | 剪贴板 | `sudo apt install xclip` |
| `wmctrl` | 窗口列表/切换 | `sudo apt install wmctrl` |

Wayland 环境需要替代工具：`ydotool`（替代 xdotool）、`grim`（替代 scrot）、`wl-clipboard`（替代 xclip）。初期只支持 X11，Wayland 标记为 todo。

### macOS 权限

macOS 首次使用需要授予「辅助功能」和「屏幕录制」权限（系统会提示）。

### Windows

无需额外权限，开箱即用。

## 3. 实施细节

### 3.1 功能开关（gates.ts）

- `enabled` 默认为 `true`，无需订阅检查
- `hasRequiredSubscription()` 直接返回 `true`
- 子开关（鼠标动画、隐藏窗口、剪贴板守卫等）均通过 GrowthBook 远程配置或使用默认值

### 3.2 平台分发

所有平台相关逻辑已通过 `process.platform` 判断分发：

| 文件 | 处理方式 |
|------|---------|
| `executor.ts` | 剪贴板：darwin→pbcopy/pbpaste，win32→PowerShell，linux→xclip；粘贴键：darwin→command+v，其他→ctrl+v |
| `drainRunLoop.ts` | 非 darwin 直接执行 fn()，不需要 CFRunLoop pump |
| `escHotkey.ts` | 非 darwin 返回 false（已有 Ctrl+C fallback） |
| `hostAdapter.ts` | 非 darwin 直接返回 `{ granted: true }`，macOS 检查 TCC 权限 |
| `common.ts` | 动态获取 platform 标识，截图过滤按平台选择 |
| `swiftLoader.ts` | 自动检测包导出类型，跨平台实例化 `ComputerUseAPI` |
| `main.tsx` | 仅检查 `feature('CHICAGO_MCP')` + 交互模式，无平台限制 |

### 3.3 每个平台的能力依赖

#### computer-use-input（键鼠）

| 功能 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 鼠标移动 | CGEvent JXA | SetCursorPos P/Invoke | xdotool mousemove |
| 鼠标点击 | CGEvent JXA | SendInput P/Invoke | xdotool click |
| 鼠标滚轮 | CGEvent JXA | SendInput MOUSEEVENTF_WHEEL | xdotool scroll |
| 键盘按键 | System Events osascript | keybd_event P/Invoke | xdotool key |
| 组合键 | System Events osascript | keybd_event 组合 | xdotool key combo |
| 文本输入 | System Events keystroke | SendKeys.SendWait | xdotool type |
| 前台应用 | System Events osascript | GetForegroundWindow P/Invoke | xdotool getactivewindow + /proc |
| 工具依赖 | osascript（内置） | powershell（内置） | xdotool（需安装） |

#### computer-use-swift（截图 + 应用管理）

| 功能 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 全屏截图 | screencapture | CopyFromScreen | gnome-screenshot / scrot / grim |
| 区域截图 | screencapture -R | CopyFromScreen(rect) | gnome-screenshot -a / scrot -a / grim -g |
| 显示器列表 | CGGetActiveDisplayList JXA | Screen.AllScreens | xrandr --query |
| 运行中应用 | System Events JXA | Get-Process | wmctrl -l / ps |
| 打开应用 | osascript activate | Start-Process | xdg-open / gtk-launch |
| 隐藏/显示 | System Events visibility | ShowWindow/SetForegroundWindow | wmctrl -c / xdotool |
| 工具依赖 | screencapture + osascript | powershell | xdotool + scrot/grim + wmctrl |

#### executor 层

| 功能 | macOS | Windows | Linux |
|------|-------|---------|-------|
| drainRunLoop | CFRunLoop pump | 不需要 | 不需要 |
| ESC 热键 | CGEventTap | 跳过（Ctrl+C fallback） | 跳过（Ctrl+C fallback） |
| 剪贴板读 | pbpaste | `powershell Get-Clipboard` | xclip -o / wl-paste |
| 剪贴板写 | pbcopy | `powershell Set-Clipboard` | xclip / wl-copy |
| 粘贴快捷键 | command+v | ctrl+v | ctrl+v |
| 终端检测 | __CFBundleIdentifier | WT_SESSION / TERM_PROGRAM | TERM_PROGRAM |
| 系统权限 | TCC check | 直接 granted | 检查 xdotool 安装 |

## 4. 完成状态

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 1 | MCP 实现 + Windows 后端 | ✅ 已完成 |
| Phase 2 | 移除 macOS 硬编码 | ✅ 已完成 |
| Phase 3 | Linux 后端（待新建 linux.ts） | ❌ 未完成 |

Phase 1-2 完成后 macOS + Windows 可用。Phase 3（Linux 后端）需要新建 `packages/@ant/computer-use-input/src/backends/linux.ts`（~150 行）和 `packages/@ant/computer-use-swift/src/backends/linux.ts`（~200 行），并在对应 dispatcher 中加 `case 'linux'`。
