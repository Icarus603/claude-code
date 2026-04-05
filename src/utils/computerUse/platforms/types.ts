/**
 * Cross-platform abstraction types for Computer Use.
 *
 * These interfaces define a unified API surface for input, screenshots,
 * display info, and app management across macOS, Windows, and Linux.
 */

// ---------------------------------------------------------------------------
// Window / App types
// ---------------------------------------------------------------------------

/** Cross-platform window identifier */
export interface WindowHandle {
  id: string // macOS: bundleId, Windows: HWND string, Linux: window ID
  pid: number
  title: string
  exePath?: string // Windows/Linux: process executable path
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
  id: string // macOS: bundleId, Windows: exe path or package family, Linux: .desktop name
  displayName: string
  path: string
}

export interface FrontmostAppInfo {
  id: string
  appName: string
}

// ---------------------------------------------------------------------------
// InputPlatform
// ---------------------------------------------------------------------------

/**
 * Input platform interface — two modes:
 *
 * Mode A (Global): moveMouse, click, typeText, key, keys, scroll, mouseLocation
 *   Works on all platforms. Sends input to the foreground window; moves the
 *   real cursor and steals focus.
 *
 * Mode B (Window-bound, optional): sendChar, sendKey, sendClick, sendText
 *   Windows-only via SendMessage/PostMessage. Does NOT steal focus or move
 *   the cursor. Preferred when a target HWND is known.
 */
export interface InputPlatform {
  // --- Mode A: Global input (all platforms) ---
  moveMouse(x: number, y: number): Promise<void>
  click(
    x: number,
    y: number,
    button: 'left' | 'right' | 'middle',
  ): Promise<void>
  typeText(text: string): Promise<void>
  key(name: string, action: 'press' | 'release'): Promise<void>
  keys(combo: string[]): Promise<void>
  scroll(amount: number, direction: 'vertical' | 'horizontal'): Promise<void>
  mouseLocation(): Promise<{ x: number; y: number }>

  // --- Mode B: Window-bound input (Windows only, optional) ---
  sendChar?(hwnd: string, char: string): Promise<void>
  sendKey?(hwnd: string, vk: number, action: 'down' | 'up'): Promise<void>
  sendClick?(
    hwnd: string,
    x: number,
    y: number,
    button: 'left' | 'right',
  ): Promise<void>
  sendText?(hwnd: string, text: string): Promise<void>
}

// ---------------------------------------------------------------------------
// ScreenshotPlatform
// ---------------------------------------------------------------------------

export interface ScreenshotPlatform {
  /** Full-screen capture. Returns JPEG base64. */
  captureScreen(displayId?: number): Promise<ScreenshotResult>
  /** Region capture. Returns JPEG base64. */
  captureRegion(
    x: number,
    y: number,
    w: number,
    h: number,
  ): Promise<ScreenshotResult>
  /** Window capture (Windows: PrintWindow, macOS: SCContentFilter, Linux: xdotool+import). */
  captureWindow?(hwnd: string): Promise<ScreenshotResult | null>
}

// ---------------------------------------------------------------------------
// DisplayPlatform
// ---------------------------------------------------------------------------

export interface DisplayPlatform {
  listAll(): DisplayInfo[]
  getSize(displayId?: number): DisplayInfo
}

// ---------------------------------------------------------------------------
// AppsPlatform
// ---------------------------------------------------------------------------

export interface AppsPlatform {
  listRunning(): WindowHandle[]
  listInstalled(): Promise<InstalledApp[]>
  open(name: string): Promise<void>
  getFrontmostApp(): FrontmostAppInfo | null
  findWindowByTitle(title: string): WindowHandle | null
}

// ---------------------------------------------------------------------------
// WindowManagementPlatform (Windows HWND-targeted, no global APIs)
// ---------------------------------------------------------------------------

export type WindowAction =
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'close'
  | 'focus'
  | 'move_offscreen'
  | 'move_resize'
  | 'get_rect'

export interface WindowManagementPlatform {
  /** Perform a window management action on the bound HWND. All via Win32 API, no global shortcuts. */
  manageWindow(
    action: WindowAction,
    opts?: { x?: number; y?: number; width?: number; height?: number },
  ): boolean
  /** Move window to specific position and/or resize */
  moveResize(x: number, y: number, width?: number, height?: number): boolean
  /** Get current window rect */
  getWindowRect(): {
    x: number
    y: number
    width: number
    height: number
  } | null
}
