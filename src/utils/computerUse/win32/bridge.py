"""
Python Bridge for Windows Computer Use.

Long-lived subprocess communicating via stdin/stdout JSON lines.
Replaces per-call PowerShell spawning with a persistent process.

Capabilities:
  - screenshot: full-screen or per-window (mss + PrintWindow)
  - input: mouse click/move/drag, keyboard type/key (ctypes user32)
  - windows: enumerate, find, get rect, manage (show/min/max/close)
  - accessibility: UI Automation tree snapshot (comtypes + UIAutomation)

Protocol: one JSON object per line on stdin → one JSON object per line on stdout.
  Request:  {"id": 1, "method": "screenshot", "params": {...}}
  Response: {"id": 1, "result": {...}}  or  {"id": 1, "error": "message"}
"""

import sys
import json
import base64
import io
import ctypes
import ctypes.wintypes
import time
import os

# Force UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')
sys.stdin.reconfigure(encoding='utf-8')

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32

# ---------------------------------------------------------------------------
# Win32 constants & types
# ---------------------------------------------------------------------------
WM_CHAR = 0x0102
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_CLOSE = 0x0010
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
WM_RBUTTONDOWN = 0x0204
WM_RBUTTONUP = 0x0205
WM_MOUSEMOVE = 0x0200

SW_MINIMIZE = 6
SW_MAXIMIZE = 3
SW_RESTORE = 9
SW_SHOWMINNOACTIVE = 7

SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

# SendMessageW
SendMessageW = user32.SendMessageW
SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
SendMessageW.restype = ctypes.c_void_p

# ---------------------------------------------------------------------------
# Screenshot
# ---------------------------------------------------------------------------
def screenshot_full(display_id=0):
    """Full-screen screenshot via mss, returns JPEG base64."""
    import mss
    from PIL import Image
    with mss.mss() as sct:
        monitor = sct.monitors[display_id + 1] if display_id < len(sct.monitors) - 1 else sct.monitors[1]
        shot = sct.grab(monitor)
        img = Image.frombytes('RGB', shot.size, shot.bgra, 'raw', 'BGRX')
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=75)
        return {
            'base64': base64.b64encode(buf.getvalue()).decode(),
            'width': shot.width,
            'height': shot.height,
        }

def screenshot_window(hwnd_str):
    """Window screenshot via PrintWindow, returns JPEG base64."""
    from PIL import Image
    hwnd = int(hwnd_str)
    if not user32.IsWindow(hwnd):
        return None

    # Get window rect
    rect = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    w = rect.right - rect.left
    h = rect.bottom - rect.top
    if w <= 0 or h <= 0:
        return None

    # Handle minimized windows
    was_minimized = user32.IsIconic(hwnd)
    if was_minimized:
        user32.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE
        time.sleep(0.1)
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        w = rect.right - rect.left
        h = rect.bottom - rect.top

    # Create DC and bitmap
    hdc_window = user32.GetDC(hwnd)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_window)
    hbm = gdi32.CreateCompatibleBitmap(hdc_window, w, h)
    gdi32.SelectObject(hdc_mem, hbm)

    # PrintWindow with PW_RENDERFULLCONTENT
    result = ctypes.windll.user32.PrintWindow(hwnd, hdc_mem, 2)

    if not result:
        # Fallback to BitBlt
        gdi32.BitBlt(hdc_mem, 0, 0, w, h, hdc_window, 0, 0, 0x00CC0020)  # SRCCOPY

    # Extract bitmap bits
    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ('biSize', ctypes.c_uint32), ('biWidth', ctypes.c_int32),
            ('biHeight', ctypes.c_int32), ('biPlanes', ctypes.c_uint16),
            ('biBitCount', ctypes.c_uint16), ('biCompression', ctypes.c_uint32),
            ('biSizeImage', ctypes.c_uint32), ('biXPelsPerMeter', ctypes.c_int32),
            ('biYPelsPerMeter', ctypes.c_int32), ('biClrUsed', ctypes.c_uint32),
            ('biClrImportant', ctypes.c_uint32),
        ]

    bmi = BITMAPINFOHEADER()
    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.biWidth = w
    bmi.biHeight = -h  # top-down
    bmi.biPlanes = 1
    bmi.biBitCount = 32
    bmi.biCompression = 0  # BI_RGB

    buf_size = w * h * 4
    pixel_buf = ctypes.create_string_buffer(buf_size)
    gdi32.GetDIBits(hdc_mem, hbm, 0, h, pixel_buf, ctypes.byref(bmi), 0)

    # Cleanup GDI
    gdi32.DeleteObject(hbm)
    gdi32.DeleteDC(hdc_mem)
    user32.ReleaseDC(hwnd, hdc_window)

    if was_minimized:
        user32.ShowWindow(hwnd, SW_SHOWMINNOACTIVE)

    # Convert to JPEG
    img = Image.frombuffer('RGBA', (w, h), pixel_buf, 'raw', 'BGRA', 0, 1)
    img = img.convert('RGB')
    out = io.BytesIO()
    img.save(out, format='JPEG', quality=75)

    return {
        'base64': base64.b64encode(out.getvalue()).decode(),
        'width': w,
        'height': h,
    }

# ---------------------------------------------------------------------------
# Window management
# ---------------------------------------------------------------------------
def list_windows():
    """Enumerate all visible windows with title."""
    windows = []
    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                pid = ctypes.c_uint32()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                windows.append({'hwnd': str(hwnd), 'pid': pid.value, 'title': buf.value})
        return True
    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return windows

def get_window_rect(hwnd_str):
    hwnd = int(hwnd_str)
    rect = RECT()
    if user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return {'x': rect.left, 'y': rect.top,
                'width': rect.right - rect.left, 'height': rect.bottom - rect.top}
    return None

def get_client_offset(hwnd_str):
    """Get non-client area offset (title bar height, border width)."""
    hwnd = int(hwnd_str)
    wr = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(wr))
    pt = POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    return {'dx': pt.x - wr.left, 'dy': pt.y - wr.top}

def manage_window(hwnd_str, action):
    hwnd = int(hwnd_str)
    if action == 'minimize':
        return user32.ShowWindow(hwnd, SW_SHOWMINNOACTIVE)
    elif action == 'maximize':
        return user32.ShowWindow(hwnd, SW_MAXIMIZE)
    elif action == 'restore':
        return user32.ShowWindow(hwnd, SW_RESTORE)
    elif action == 'close':
        SendMessageW(hwnd, WM_CLOSE, 0, 0)
        return True
    elif action == 'focus':
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)
        user32.SetForegroundWindow(hwnd)
        return True
    elif action == 'move_offscreen':
        user32.SetWindowPos(hwnd, 0, -32000, -32000, 0, 0,
                           SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
        return True
    return False

# ---------------------------------------------------------------------------
# Input — all via SendMessageW (window-targeted, no global)
# ---------------------------------------------------------------------------
def make_lparam(x, y):
    return (y << 16) | (x & 0xFFFF)

def send_click(hwnd_str, x, y, button='left'):
    hwnd = int(hwnd_str)
    lp = make_lparam(x, y)
    if button == 'left':
        SendMessageW(hwnd, WM_LBUTTONDOWN, 0, lp)
        SendMessageW(hwnd, WM_LBUTTONUP, 0, lp)
    elif button == 'right':
        SendMessageW(hwnd, WM_RBUTTONDOWN, 0, lp)
        SendMessageW(hwnd, WM_RBUTTONUP, 0, lp)
    return True

def send_text(hwnd_str, text):
    """Send text via WM_CHAR (Unicode). Handles surrogate pairs."""
    hwnd = int(hwnd_str)
    for ch in text:
        cp = ord(ch)
        if cp <= 0xFFFF:
            SendMessageW(hwnd, WM_CHAR, cp, 0)
        else:
            # Surrogate pair
            hi = ((cp - 0x10000) >> 10) + 0xD800
            lo = ((cp - 0x10000) & 0x3FF) + 0xDC00
            SendMessageW(hwnd, WM_CHAR, hi, 0)
            SendMessageW(hwnd, WM_CHAR, lo, 0)
    return True

def send_key(hwnd_str, vk, action='down'):
    hwnd = int(hwnd_str)
    msg = WM_KEYDOWN if action == 'down' else WM_KEYUP
    SendMessageW(hwnd, msg, vk, 0)
    return True

def send_keys_combo(hwnd_str, keys):
    """Send a key combination like ['ctrl', 's']."""
    VK = {
        'ctrl': 0x11, 'control': 0x11, 'shift': 0x10, 'alt': 0x12,
        'enter': 0x0D, 'return': 0x0D, 'tab': 0x09, 'escape': 0x1B,
        'backspace': 0x08, 'delete': 0x2E, 'space': 0x20,
        'left': 0x25, 'up': 0x26, 'right': 0x27, 'down': 0x28,
        'home': 0x24, 'end': 0x23, 'pageup': 0x21, 'pagedown': 0x22,
        'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73, 'f5': 0x74,
        'f6': 0x75, 'f7': 0x76, 'f8': 0x77, 'f9': 0x78, 'f10': 0x79,
        'f11': 0x7A, 'f12': 0x7B,
    }
    MODIFIERS = {'ctrl', 'control', 'shift', 'alt'}
    hwnd = int(hwnd_str)
    mods = []
    main_key = None
    for k in keys:
        kl = k.lower()
        if kl in MODIFIERS:
            mods.append(VK.get(kl, 0))
        elif kl in VK:
            main_key = VK[kl]
        elif len(kl) == 1:
            main_key = ord(kl.upper())
    if main_key is None:
        return False
    for m in mods:
        SendMessageW(hwnd, WM_KEYDOWN, m, 0)
    SendMessageW(hwnd, WM_KEYDOWN, main_key, 0)
    SendMessageW(hwnd, WM_KEYUP, main_key, 0)
    for m in reversed(mods):
        SendMessageW(hwnd, WM_KEYUP, m, 0)
    return True

def send_mouse_down(hwnd_str, x, y):
    hwnd = int(hwnd_str)
    SendMessageW(hwnd, WM_LBUTTONDOWN, 0, make_lparam(x, y))
    return True

def send_mouse_up(hwnd_str, x, y):
    hwnd = int(hwnd_str)
    SendMessageW(hwnd, WM_LBUTTONUP, 0, make_lparam(x, y))
    return True

def send_mouse_move(hwnd_str, x, y):
    hwnd = int(hwnd_str)
    SendMessageW(hwnd, WM_MOUSEMOVE, 0, make_lparam(x, y))
    return True

# ---------------------------------------------------------------------------
# Accessibility snapshot (UI Automation via comtypes)
# ---------------------------------------------------------------------------
_uia_client = None

def _get_uia():
    global _uia_client
    if _uia_client is None:
        try:
            import comtypes.client
            comtypes.client.GetModule('UIAutomationCore.dll')
            from comtypes.gen.UIAutomationClient import CUIAutomation
            _uia_client = comtypes.client.CreateObject(CUIAutomation)
        except Exception:
            # Fallback: use pywinauto
            pass
    return _uia_client

def accessibility_snapshot(hwnd_str, max_depth=4):
    """Get the accessibility tree using pywinauto (more reliable than raw comtypes)."""
    try:
        from pywinauto import Desktop
        from pywinauto.controls.uiawrapper import UIAWrapper

        hwnd = int(hwnd_str)
        app = Desktop(backend='uia')
        # Find window by handle
        win = None
        for w in app.windows():
            if w.handle == hwnd:
                win = w
                break
        if win is None:
            return None

        INTERACTIVE = {'Button', 'Edit', 'ComboBox', 'CheckBox', 'RadioButton',
                       'MenuItem', 'Menu', 'MenuBar', 'Hyperlink', 'Slider',
                       'Tab', 'TabItem', 'List', 'ListItem', 'Document',
                       'TreeItem', 'DataItem', 'ToolBar', 'SplitButton'}

        def walk(element, depth):
            if depth >= max_depth:
                return []
            nodes = []
            try:
                children = element.children()
            except Exception:
                return []
            for child in children:
                try:
                    ct = child.element_info.control_type or ''
                    name = child.element_info.name or ''
                    auto_id = child.element_info.automation_id or ''
                    rect = child.rectangle()
                    w = rect.right - rect.left
                    h = rect.bottom - rect.top
                    if w <= 0 or h <= 0 or rect.left < -10000:
                        continue
                    enabled = child.is_enabled()
                    value = None
                    try:
                        value = child.get_value()
                    except Exception:
                        pass
                    sub = walk(child, depth + 1)
                    if ct in INTERACTIVE or sub:
                        node = {
                            'role': ct, 'name': name, 'id': auto_id,
                            'x': rect.left, 'y': rect.top, 'w': w, 'h': h,
                            'on': enabled,
                        }
                        if value:
                            node['v'] = str(value)[:100]
                        if sub:
                            node['c'] = sub
                        nodes.append(node)
                except Exception:
                    continue
            return nodes

        tree = walk(win, 0)
        return tree if tree else None
    except Exception as e:
        return None

# ---------------------------------------------------------------------------
# Find edit child (for text input targeting)
# ---------------------------------------------------------------------------
def find_edit_child(hwnd_str):
    """Find the best edit control child using UI Automation."""
    try:
        from pywinauto import Desktop
        hwnd = int(hwnd_str)
        app = Desktop(backend='uia')
        for w in app.windows():
            if w.handle == hwnd:
                # Find first Edit or Document control
                for child in w.descendants():
                    try:
                        ct = child.element_info.control_type
                        if ct in ('Edit', 'Document'):
                            return str(child.handle) if child.handle else None
                    except Exception:
                        continue
                break
    except Exception:
        pass
    return None

# ---------------------------------------------------------------------------
# Clipboard paste (for large text)
# ---------------------------------------------------------------------------
def paste_text(hwnd_str, text):
    """Set clipboard + send Ctrl+V via SendMessage."""
    import ctypes
    # Set clipboard
    CF_UNICODETEXT = 13
    user32.OpenClipboard(0)
    user32.EmptyClipboard()
    data = text.encode('utf-16-le') + b'\x00\x00'
    h = kernel32.GlobalAlloc(0x0002, len(data))  # GMEM_MOVEABLE
    ptr = kernel32.GlobalLock(h)
    ctypes.memmove(ptr, data, len(data))
    kernel32.GlobalUnlock(h)
    user32.SetClipboardData(CF_UNICODETEXT, h)
    user32.CloseClipboard()
    # Send Ctrl+V
    send_keys_combo(hwnd_str, ['ctrl', 'v'])
    return True

# ---------------------------------------------------------------------------
# Mouse wheel scroll (WM_MOUSEWHEEL / WM_MOUSEHWHEEL)
# ---------------------------------------------------------------------------
WM_MOUSEWHEEL = 0x020A
WM_MOUSEHWHEEL = 0x020E

# ClientToScreen for screen coords in lParam
user32.ClientToScreen.argtypes = [ctypes.c_void_p, ctypes.POINTER(POINT)]
user32.ClientToScreen.restype = ctypes.c_bool

def send_mouse_wheel(hwnd_str, x, y, delta, horizontal=False):
    """Send mouse wheel scroll at client coordinates (x, y).
    delta: positive = up/right, negative = down/left. In "clicks" (1 click = 120 units).
    """
    hwnd = int(hwnd_str)
    msg = WM_MOUSEHWHEEL if horizontal else WM_MOUSEWHEEL
    wheel_delta = int(delta) * 120
    # Convert client coords to screen coords for lParam
    pt = POINT(int(x), int(y))
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    # wParam: high word = delta (signed short), low word = modifier keys (0)
    wparam = ctypes.c_void_p(wheel_delta << 16)
    # lParam: screen coords
    lparam = ctypes.c_void_p((pt.y << 16) | (pt.x & 0xFFFF))
    SendMessageW(hwnd, msg, wparam, lparam)
    return True

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
METHODS = {
    'screenshot': lambda p: screenshot_full(p.get('display_id', 0)),
    'screenshot_window': lambda p: screenshot_window(p['hwnd']),
    'list_windows': lambda p: list_windows(),
    'get_window_rect': lambda p: get_window_rect(p['hwnd']),
    'get_client_offset': lambda p: get_client_offset(p['hwnd']),
    'manage_window': lambda p: manage_window(p['hwnd'], p['action']),
    'send_click': lambda p: send_click(p['hwnd'], p['x'], p['y'], p.get('button', 'left')),
    'send_text': lambda p: send_text(p['hwnd'], p['text']),
    'send_key': lambda p: send_key(p['hwnd'], p['vk'], p.get('action', 'down')),
    'send_keys': lambda p: send_keys_combo(p['hwnd'], p['keys']),
    'send_mouse_down': lambda p: send_mouse_down(p['hwnd'], p['x'], p['y']),
    'send_mouse_up': lambda p: send_mouse_up(p['hwnd'], p['x'], p['y']),
    'send_mouse_move': lambda p: send_mouse_move(p['hwnd'], p['x'], p['y']),
    'paste_text': lambda p: paste_text(p['hwnd'], p['text']),
    'send_mouse_wheel': lambda p: send_mouse_wheel(p['hwnd'], p['x'], p['y'], p['delta'], p.get('horizontal', False)),
    'find_edit_child': lambda p: find_edit_child(p['hwnd']),
    'accessibility_snapshot': lambda p: accessibility_snapshot(p['hwnd'], p.get('max_depth', 4)),
    'ping': lambda p: {'ok': True, 'pid': os.getpid()},
}

def main():
    """Main loop: read JSON lines from stdin, dispatch, write JSON lines to stdout."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get('id', 0)
            method = req.get('method', '')
            params = req.get('params', {})

            if method not in METHODS:
                resp = {'id': req_id, 'error': f'unknown method: {method}'}
            else:
                try:
                    result = METHODS[method](params)
                    resp = {'id': req_id, 'result': result}
                except Exception as e:
                    resp = {'id': req_id, 'error': str(e)}

            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + '\n')
            sys.stdout.flush()
        except json.JSONDecodeError as e:
            sys.stdout.write(json.dumps({'id': 0, 'error': f'invalid JSON: {e}'}) + '\n')
            sys.stdout.flush()

if __name__ == '__main__':
    main()
