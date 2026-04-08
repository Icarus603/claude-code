# Computer Use — macOS / Windows / Linux 跨平臺實施計劃

更新時間：2026-04-03
參考專案：`E:\源碼\claude-code-source-main\claude-code-source-main`

## 1. 現狀

參考專案的 Computer Use **僅支援 macOS**——從入口到底層全部寫死 darwin。我們的專案在 Phase 1-3 中已經完成了：

- ✅ `@ant/computer-use-mcp` stub 替換爲完整實現（12 文件）
- ✅ `@ant/computer-use-input` 拆爲 dispatcher + backends（darwin + win32）
- ✅ `@ant/computer-use-swift` 拆爲 dispatcher + backends（darwin + win32）
- ✅ `CHICAGO_MCP` 編譯開關已開
- ❌ `src/` 層有 6 處 macOS 硬編碼阻塞

## 2. 阻塞點全景

### 2.1 入口層

| # | 文件:行號 | 阻塞程式碼 | 影響 |
|---|----------|---------|------|
| 1 | `src/main.tsx:1605` | `getPlatform() === 'macos'` | 整個 CU 初始化被跳過 |

### 2.2 加載層

| # | 文件:行號 | 阻塞程式碼 | 影響 |
|---|----------|---------|------|
| 2 | `src/utils/computerUse/swiftLoader.ts:16` | `process.platform !== 'darwin'` → throw | 截圖、應用管理全部不可用 |
| 3 | `src/utils/computerUse/executor.ts:263` | `process.platform !== 'darwin'` → throw | 整個 executor 工廠函數不可用 |

### 2.3 macOS 特有依賴

| # | 文件:行號 | 依賴 | macOS 實現 | 需要替代方案 |
|---|----------|------|-----------|------------|
| 4 | `executor.ts:70-88` | 剪貼板 | `pbcopy`/`pbpaste` | Win: PowerShell `Get/Set-Clipboard`；Linux: `xclip`/`wl-copy` |
| 5 | `drainRunLoop.ts:21` | CFRunLoop pump | `cu._drainMainRunLoop()` | 非 darwin：直接執行 fn()，不需要 pump |
| 6 | `escHotkey.ts:28` | ESC 熱鍵 | CGEventTap | 非 darwin：返回 false（已有 Ctrl+C fallback） |
| 7 | `hostAdapter.ts:48-54` | 系統權限 | TCC accessibility + screenRecording | Win：直接 granted；Linux：檢查 xdotool |
| 8 | `common.ts:56` | 平臺標識 | `platform: 'darwin'` 硬編碼 | 動態取得 |
| 9 | `executor.ts:180` | 粘貼快捷鍵 | `command+v` | Win/Linux：`ctrl+v` |

### 2.4 缺失的 Linux 後端

| 包 | macOS | Windows | Linux |
|---|-------|---------|-------|
| `computer-use-input/backends/` | ✅ darwin.ts | ✅ win32.ts | ❌ 需新建 linux.ts |
| `computer-use-swift/backends/` | ✅ darwin.ts | ✅ win32.ts | ❌ 需新建 linux.ts |

## 3. 每個平臺的能力依賴

### 3.1 computer-use-input（鍵鼠）

| 功能 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 鼠標移動 | CGEvent JXA | SetCursorPos P/Invoke | xdotool mousemove |
| 鼠標點擊 | CGEvent JXA | SendInput P/Invoke | xdotool click |
| 鼠標滾輪 | CGEvent JXA | SendInput MOUSEEVENTF_WHEEL | xdotool scroll |
| 鍵盤按鍵 | System Events osascript | keybd_event P/Invoke | xdotool key |
| 組合鍵 | System Events osascript | keybd_event 組合 | xdotool key combo |
| 文本輸入 | System Events keystroke | SendKeys.SendWait | xdotool type |
| 前臺應用 | System Events osascript | GetForegroundWindow P/Invoke | xdotool getactivewindow + /proc |
| 工具依賴 | osascript（內置） | powershell（內置） | xdotool（需安裝） |

### 3.2 computer-use-swift（截圖 + 應用管理）

| 功能 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 全屏截圖 | screencapture | CopyFromScreen | gnome-screenshot / scrot / grim |
| 區域截圖 | screencapture -R | CopyFromScreen(rect) | gnome-screenshot -a / scrot -a / grim -g |
| 顯示器列表 | CGGetActiveDisplayList JXA | Screen.AllScreens | xrandr --query |
| 執行中應用 | System Events JXA | Get-Process | wmctrl -l / ps |
| 打開應用 | osascript activate | Start-Process | xdg-open / gtk-launch |
| 隱藏/顯示 | System Events visibility | ShowWindow/SetForegroundWindow | wmctrl -c / xdotool |
| 工具依賴 | screencapture + osascript | powershell | xdotool + scrot/grim + wmctrl |

### 3.3 executor 層

| 功能 | macOS | Windows | Linux |
|------|-------|---------|-------|
| drainRunLoop | CFRunLoop pump | 不需要 | 不需要 |
| ESC 熱鍵 | CGEventTap | 跳過（Ctrl+C fallback） | 跳過（Ctrl+C fallback） |
| 剪貼板讀 | pbpaste | `powershell Get-Clipboard` | xclip -o / wl-paste |
| 剪貼板寫 | pbcopy | `powershell Set-Clipboard` | xclip / wl-copy |
| 粘貼快捷鍵 | command+v | ctrl+v | ctrl+v |
| 終端檢測 | __CFBundleIdentifier | WT_SESSION / TERM_PROGRAM | TERM_PROGRAM |
| 系統權限 | TCC check | 直接 granted | 檢查 xdotool 安裝 |

## 4. 執行步驟

### Phase 1：已完成 ✅

- [x] `@ant/computer-use-mcp` stub → 完整實現
- [x] `@ant/computer-use-input` dispatcher + darwin/win32 backends
- [x] `@ant/computer-use-swift` dispatcher + darwin/win32 backends
- [x] `CHICAGO_MCP` 編譯開關

### Phase 2：移除 6 處 macOS 硬編碼（解鎖 macOS + Windows）

**改動原則：macOS 程式碼路徑不變，只在每處 darwin 守衛後加 win32/linux 分支。**

| 步驟 | 文件 | 改動 |
|------|------|------|
| 2.1 | `src/main.tsx:1605` | `getPlatform() === 'macos'` → 去掉平臺限制，或改爲 `!== 'unknown'` |
| 2.2 | `src/utils/computerUse/swiftLoader.ts:16-18` | 移除 `process.platform !== 'darwin'` throw。`@ant/computer-use-swift/index.ts` 已有跨平臺 dispatch |
| 2.3 | `src/utils/computerUse/executor.ts:263-267` | 移除 `process.platform !== 'darwin'` throw。改爲檢查 input/swift isSupported |
| 2.4 | `src/utils/computerUse/executor.ts:70-88` | 剪貼板函數按平臺分發：darwin→pbcopy/pbpaste，win32→PowerShell Get/Set-Clipboard，linux→xclip |
| 2.5 | `src/utils/computerUse/executor.ts:180` | `typeViaClipboard` 中 `command+v` → 非 darwin 時用 `ctrl+v` |
| 2.6 | `src/utils/computerUse/executor.ts:273` | `const cu = requireComputerUseSwift()` → 改爲 `new ComputerUseAPI()`（從 package 直接實例化，不走 swiftLoader throw） |
| 2.7 | `src/utils/computerUse/drainRunLoop.ts` | 開頭加 `if (process.platform !== 'darwin') return fn()` |
| 2.8 | `src/utils/computerUse/escHotkey.ts` | `registerEscHotkey` 非 darwin 返回 false（已有 Ctrl+C fallback） |
| 2.9 | `src/utils/computerUse/hostAdapter.ts:48-54` | `ensureOsPermissions` 非 darwin 返回 `{ granted: true }` |
| 2.10 | `src/utils/computerUse/common.ts:56` | `platform: 'darwin'` → `platform: process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : 'darwin'` |
| 2.11 | `src/utils/computerUse/common.ts:55` | `screenshotFiltering: 'native'` → 非 darwin 時 `'none'`（Windows/Linux 截圖不支援 per-app 過濾） |
| 2.12 | `src/utils/computerUse/gates.ts:13` | `enabled: false` → `enabled: true`（無 GrowthBook 時預設可用） |
| 2.13 | `src/utils/computerUse/gates.ts:39-43` | `hasRequiredSubscription()` → 直接返回 `true` |

### Phase 3：新增 Linux 後端

| 步驟 | 文件 | 內容 |
|------|------|------|
| 3.1 | `packages/@ant/computer-use-input/src/backends/linux.ts` | xdotool 鍵鼠（mousemove/click/key/type/getactivewindow） |
| 3.2 | `packages/@ant/computer-use-swift/src/backends/linux.ts` | scrot/grim 截圖 + xrandr 顯示器 + wmctrl 窗口管理 |
| 3.3 | `packages/@ant/computer-use-input/src/index.ts` | dispatcher 加 `case 'linux'` |
| 3.4 | `packages/@ant/computer-use-swift/src/index.ts` | dispatcher 加 `case 'linux'` |

### Phase 4：驗證

| 測試項 | macOS | Windows | Linux |
|--------|-------|---------|-------|
| build 成功 | ✅ | 驗證 | 驗證 |
| MCP 工具列表非空 | 驗證 | 驗證 | 驗證 |
| 鼠標移動 | 驗證 | ✅ 已通過 | 驗證 |
| 截圖 | 驗證 | ✅ 已通過 | 驗證 |
| 鍵盤輸入 | 驗證 | 驗證 | 驗證 |
| 前臺窗口 | 驗證 | ✅ 已通過 | 驗證 |
| 剪貼板 | 驗證 | 驗證 | 驗證 |

## 5. 文件改動總覽

### 不動的文件（14 個）

`cleanup.ts`、`computerUseLock.ts`、`wrapper.tsx`、`toolRendering.tsx`、`mcpServer.ts`、`setup.ts`、`appNames.ts`、`inputLoader.ts`、`src/services/mcp/client.ts`、`@ant/computer-use-mcp/src/*`（Phase 1 已完成）、`backends/darwin.ts`（兩個包都不動）

### 改 src/ 的文件（8 個）

| 文件 | 改動量 | 風險 |
|------|--------|------|
| `main.tsx` | 1 行 | 低 |
| `swiftLoader.ts` | 2 行 | 低 |
| `executor.ts` | ~40 行（剪貼板分發 + 平臺守衛 + paste 快捷鍵） | **中** |
| `drainRunLoop.ts` | 1 行 | 低 |
| `escHotkey.ts` | 3 行 | 低 |
| `hostAdapter.ts` | 5 行 | 低 |
| `common.ts` | 3 行 | 低 |
| `gates.ts` | 3 行 | 低 |

### 新增文件（2 個）

| 文件 | 行數估算 |
|------|---------|
| `packages/@ant/computer-use-input/src/backends/linux.ts` | ~150 行 |
| `packages/@ant/computer-use-swift/src/backends/linux.ts` | ~200 行 |

## 6. Linux 依賴工具

| 工具 | 用途 | 安裝命令（Ubuntu） |
|------|------|-------------------|
| `xdotool` | 鍵鼠模擬 + 窗口管理 | `sudo apt install xdotool` |
| `scrot` 或 `gnome-screenshot` | 截圖 | `sudo apt install scrot` |
| `xrandr` | 顯示器信息 | 通常已預裝 |
| `xclip` | 剪貼板 | `sudo apt install xclip` |
| `wmctrl` | 窗口列表/切換 | `sudo apt install wmctrl` |

Wayland 環境需要替代工具：`ydotool`（替代 xdotool）、`grim`（替代 scrot）、`wl-clipboard`（替代 xclip）。初期可先只支援 X11，Wayland 標記爲 todo。

## 7. 執行順序建議

```
Phase 2（解鎖 macOS + Windows）
  ├── 2.1-2.3  移除 3 處硬編碼 throw/skip
  ├── 2.4-2.5  剪貼板 + 粘貼快捷鍵平臺分發
  ├── 2.6      swiftLoader → 直接實例化
  ├── 2.7-2.9  drainRunLoop / escHotkey / permissions 平臺分支
  ├── 2.10-2.11 common.ts 平臺標識動態化
  ├── 2.12-2.13 gates.ts 預設值
  └── 驗證 Windows

Phase 3（Linux 後端）
  ├── 3.1  input/backends/linux.ts
  ├── 3.2  swift/backends/linux.ts
  ├── 3.3-3.4  dispatcher 加 linux case
  └── 驗證 Linux

Phase 4（集成驗證 + PR）
```

每個 Phase 可獨立驗證、獨立提交。Phase 2 完成後 macOS + Windows 可用，Phase 3 完成後三平臺全部可用。
