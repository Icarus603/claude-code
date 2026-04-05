/**
 * Visual indicator for bound windows — DWM native border color.
 *
 * Uses DwmSetWindowAttribute(DWMWA_BORDER_COLOR) to set a green border
 * on the bound window. The border:
 * - Is the window's OWN border, not an overlay — zero offset, zero shadow issues
 * - Follows window movement/resize/rounded corners automatically (OS-level)
 * - Persists across repaints, zero performance overhead
 * - Works on Win11 22000+ (Build 22000 = Windows 11 GA)
 *
 * No overlays, no polling, no separate processes, no z-order issues.
 */

import { validateHwnd, ps } from './shared.js'

/**
 * Set green border on bound window via DWM.
 */
export function markBound(hwnd: string): boolean {
  hwnd = validateHwnd(hwnd)
  // DWMWA_BORDER_COLOR = 34, COLORREF = 0x00BBGGRR
  // Green: R=0, G=200, B=0 → 0x0000C800
  const hr = ps(
    `Add-Type @'
using System;
using System.Runtime.InteropServices;
public class CuDwm {
    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref uint val, int size);
}
'@
$color = [uint32]0x0000C800
[CuDwm]::DwmSetWindowAttribute([IntPtr]::new([long]${hwnd}), 34, [ref]$color, 4)`,
  )
  return hr === '0'
}

/**
 * Remove border, restore default.
 */
export function unmarkBound(hwnd: string): boolean {
  hwnd = validateHwnd(hwnd)
  // DWMWA_COLOR_DEFAULT = 0xFFFFFFFF
  const hr = ps(
    `Add-Type @'
using System;
using System.Runtime.InteropServices;
public class CuDwm {
    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref uint val, int size);
}
'@
$color = [uint32]0xFFFFFFFF
[CuDwm]::DwmSetWindowAttribute([IntPtr]::new([long]${hwnd}), 34, [ref]$color, 4)`,
  )
  return hr === '0'
}

/**
 * Kill all borders — just reset all bound windows.
 * With DWM approach, no processes to kill.
 */
export function cleanupAllBorders(): void {
  // DWM border color is a window attribute — it resets automatically
  // when the process exits or the window closes. No cleanup needed.
}
