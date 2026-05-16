/**
 * Resolve a job's `state.output.result` to a clickable URL when it
 * looks like one. Source: ant `xs3` (5092.js):
 *
 *   function xs3(H) {
 *     let _ = H.trim()
 *     if (/\s/.test(_)) return null              // contains whitespace → not a URL
 *     if (/^https?:\/\//.test(_)) return _       // http(s):// URL → as-is
 *     let q = vV(_)                              // expand ~/.., absolute
 *     return nr.isAbsolute(q) ? pathToFileURL(q).href : null
 *   }
 *
 * Used by rs3 row rendering to OSC 8 hyperlink the label when the
 * worker's output.result is a URL or absolute path. The terminal opens
 * the link via FleetView's onHyperlinkClick handler (file:// → openPath,
 * http(s):// → openBrowser).
 */

import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

/**
 * ant `vV` — tilde expansion only. Doesn't resolve relatives; doesn't
 * stat the path. The xs3 caller's isAbsolute check rejects anything
 * not absolute after expansion, so relative paths are NOT hyperlinked
 * (which prevents arbitrary strings from being converted to file:// links).
 */
function expandTilde(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return `${homedir()}/${p.slice(2)}`
  return p
}

/** Source: ant xs3. Returns a URL string, or null when not a link. */
export function resolveResultUrl(text: string | undefined): string | null {
  if (text === undefined || text === '') return null
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (/\s/.test(trimmed)) return null
  if (/^https?:\/\//.test(trimmed)) return trimmed
  const expanded = expandTilde(trimmed)
  if (!isAbsolute(expanded)) return null
  try {
    return pathToFileURL(expanded).href
  } catch {
    return null
  }
}
