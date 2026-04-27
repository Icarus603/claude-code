/**
 * Virtual Cursor — visible overlay cursor for the bound window.
 *
 * Shows a small colored cursor icon on top of the bound window,
 * independent of the real mouse cursor. The user's real mouse
 * stays free for their own use.
 *
 * The virtual cursor:
 * - Moves when Computer Use calls click/moveMouse
 * - Shows click animations (brief color flash)
 * - Is click-through (WS_EX_TRANSPARENT) — doesn't intercept real mouse
 * - Tracks the bound window position via the border tracker
 * - Disappears when the window is unbound
 */

import * as fs from 'fs'
import * as path from 'path'
import { validateHwnd, getTmpDir } from './shared.js'

const CURSOR_SIZE = 20
const CURSOR_COLOR_R = 255
const CURSOR_COLOR_G = 50
const CURSOR_COLOR_B = 50
const CURSOR_OPACITY = 0.9

let cursorProc: ReturnType<typeof Bun.spawn> | null = null
let cursorStopFile: string | null = null
let cursorScriptFile: string | null = null

function buildCursorScript(hwnd: string, stopFile: string): string {
  const stopFileEscaped = stopFile.replace(/\\/g, '\\\\')
  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Drawing2D;

public class VCursor {
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hAfter, int X, int Y, int cx, int cy, uint f);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr h, out RECT r);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int L, T, R, B; }

    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_LAYERED = 0x80000;
    public const int WS_EX_TRANSPARENT = 0x20;
    public const int WS_EX_TOOLWINDOW = 0x80;
    public const int WS_EX_NOACTIVATE = 0x08000000;
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const uint SWP_NOSIZE = 0x0001;

    public static void MakeOverlay(IntPtr h) {
        int ex = GetWindowLong(h, GWL_EXSTYLE);
        ex |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        SetWindowLong(h, GWL_EXSTYLE, ex);
    }
}
'@

$targetHwnd = [IntPtr]::new([long]${hwnd})
$stopFile = '${stopFileEscaped}'
$cursorSize = ${CURSOR_SIZE}

# Create cursor form with arrow shape
$cursor = New-Object System.Windows.Forms.Form
$cursor.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$cursor.ShowInTaskbar = $false
$cursor.TopMost = $true
$cursor.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$cursor.Size = New-Object System.Drawing.Size($cursorSize, $cursorSize)
$cursor.Location = New-Object System.Drawing.Point(-32000, -32000)
$cursor.Opacity = ${CURSOR_OPACITY}
$cursor.BackColor = [System.Drawing.Color]::Magenta
$cursor.TransparencyKey = [System.Drawing.Color]::Magenta

# Draw arrow cursor shape
$bmp = New-Object System.Drawing.Bitmap($cursorSize, $cursorSize)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
# Arrow polygon (pointing top-left)
$points = @(
    (New-Object System.Drawing.Point(1, 1)),
    (New-Object System.Drawing.Point(1, 16)),
    (New-Object System.Drawing.Point(5, 12)),
    (New-Object System.Drawing.Point(9, 18)),
    (New-Object System.Drawing.Point(12, 16)),
    (New-Object System.Drawing.Point(8, 10)),
    (New-Object System.Drawing.Point(13, 10)),
    (New-Object System.Drawing.Point(1, 1))
)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(${CURSOR_COLOR_R}, ${CURSOR_COLOR_G}, ${CURSOR_COLOR_B}))
$g.FillPolygon($brush, $points)
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 1)
$g.DrawPolygon($pen, $points)
$g.Dispose()
$cursor.BackgroundImage = $bmp

$cursor.Show()
[VCursor]::MakeOverlay($cursor.Handle)

# Position file: the TS side writes "x,y" or "x,y,click" to this file
$posFile = $stopFile + '.pos'

$script:lastCX = -32000
$script:lastCY = -32000
$script:clickFlash = 0

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 16  # ~60fps

$timer.Add_Tick({
    if (-not [VCursor]::IsWindow($targetHwnd)) {
        $timer.Stop(); $cursor.Close()
        [System.Windows.Forms.Application]::ExitThread()
        return
    }
    # Check stop
    if (Test-Path $stopFile) {
        $timer.Stop(); $cursor.Close()
        try { Remove-Item $stopFile -ErrorAction SilentlyContinue } catch {}
        try { Remove-Item $posFile -ErrorAction SilentlyContinue } catch {}
        [System.Windows.Forms.Application]::ExitThread()
        return
    }
    # Read position updates
    if (Test-Path $posFile) {
        try {
            $data = Get-Content $posFile -Raw -ErrorAction SilentlyContinue
            if ($data) {
                $parts = $data.Trim().Split(',')
                if ($parts.Length -ge 2) {
                    $script:lastCX = [int]$parts[0]
                    $script:lastCY = [int]$parts[1]
                    if ($parts.Length -ge 3 -and $parts[2] -eq 'click') {
                        $script:clickFlash = 6  # flash for 6 frames (~100ms)
                    }
                }
                Remove-Item $posFile -ErrorAction SilentlyContinue
            }
        } catch {}
    }

    # Get window position to convert client coords to screen coords
    $wr = New-Object VCursor+RECT
    [VCursor]::GetWindowRect($targetHwnd, [ref]$wr) | Out-Null
    $screenX = $wr.L + $script:lastCX
    $screenY = $wr.T + $script:lastCY

    # Click flash: briefly change color
    if ($script:clickFlash -gt 0) {
        $cursor.Opacity = 1.0
        $script:clickFlash--
        if ($script:clickFlash -eq 0) {
            $cursor.Opacity = ${CURSOR_OPACITY}
        }
    }

    [VCursor]::SetWindowPos($cursor.Handle, [VCursor]::HWND_TOPMOST,
        $screenX, $screenY, 0, 0,
        [VCursor]::SWP_NOSIZE -bor [VCursor]::SWP_NOACTIVATE -bor [VCursor]::SWP_SHOWWINDOW) | Out-Null
    $cursor.Visible = $true
})

$timer.Start()
[System.Windows.Forms.Application]::Run()
`
}

/**
 * Start the virtual cursor overlay for a bound window.
 */
export function showVirtualCursor(hwnd: string): boolean {
  hwnd = validateHwnd(hwnd)
  hideVirtualCursor()
  try {
    const tmpDir = getTmpDir()
    const ts = Date.now()
    const stopFile = path.join(tmpDir, `cu_vcursor_stop_${ts}`)
    const scriptFile = path.join(tmpDir, `cu_vcursor_${ts}.ps1`)
    const script = buildCursorScript(hwnd, stopFile)
    fs.writeFileSync(scriptFile, script, 'utf-8')

    cursorProc = Bun.spawn(
      [
        'powershell',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptFile,
      ],
      { stdout: 'ignore', stderr: 'ignore' },
    )
    cursorStopFile = stopFile
    cursorScriptFile = scriptFile
    return true
  } catch {
    return false
  }
}

/**
 * Move the virtual cursor to client-area coordinates.
 */
export function moveVirtualCursor(
  x: number,
  y: number,
  isClick: boolean = false,
): void {
  if (!cursorStopFile) return
  const posFile = cursorStopFile + '.pos'
  try {
    const data = isClick
      ? `${Math.round(x)},${Math.round(y)},click`
      : `${Math.round(x)},${Math.round(y)}`
    fs.writeFileSync(posFile, data, 'utf-8')
  } catch {}
}

/**
 * Hide and destroy the virtual cursor.
 */
export function hideVirtualCursor(): void {
  if (cursorStopFile) {
    try {
      fs.writeFileSync(cursorStopFile, 'STOP', 'utf-8')
    } catch {}
    setTimeout(() => {
      try {
        cursorProc?.kill()
      } catch {}
      try {
        if (cursorScriptFile) fs.unlinkSync(cursorScriptFile)
      } catch {}
      try {
        if (cursorStopFile) fs.unlinkSync(cursorStopFile)
      } catch {}
    }, 2000)
  }
  cursorProc = null
  cursorStopFile = null
  cursorScriptFile = null
}

/**
 * Check if virtual cursor is active.
 */
export function isVirtualCursorActive(): boolean {
  return cursorProc !== null
}
