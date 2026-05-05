# @claude-code/modifiers-napi

Native macOS keyboard modifier query via `bun:ffi` against the system
Carbon framework's `CGEventSourceFlagsState`. Used as a fallback for
Shift+Enter detection in Apple Terminal, which doesn't support the
custom keybinding terminals like iTerm2 / Ghostty use.

The `-napi` suffix is a historical naming holdover from when the
implementation was a NAPI module — it's pure FFI now, no .node binary.

Returns `false` for any non-macOS platform.
