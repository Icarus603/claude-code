/**
 * Strip C0/C1 control characters from text shown in the FleetView TUI.
 * Source: ant dn8 = /[\x00-\x08\x0E-\x1F\x7F-\x9F]/g (5092.js:105).
 *
 * Note: \x09 (tab), \x0A (LF), \x0B (VT), \x0C (FF), \x0D (CR) are NOT
 * stripped — they're preserved so the renderer can decide how to handle
 * whitespace. Only "true" control bytes get removed.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: matches ant 5092.js:105
export const CONTROL_CHAR_RE = /[\x00-\x08\x0E-\x1F\x7F-\x9F]/g
