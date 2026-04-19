/**
 * REPL prompt history buffer.
 *
 * Owns the ring buffer of prior user inputs plus navigation state
 * (cursor + working-copy), so the prompt-input React component can
 * stay a thin view on top of a deterministic store.
 *
 * Keeping this host-independent (no React, no Ink) lets the bridge
 * layer and headless smoke tests exercise the same code path as the
 * interactive REPL.
 */

export interface InputHistoryEntry {
  readonly text: string
  readonly submittedAtMs: number
}

export interface InputHistoryStore {
  push(text: string): void
  back(current: string): string
  forward(current: string): string
  reset(): void
  entries(): readonly InputHistoryEntry[]
  size(): number
  atHead(): boolean
  atTail(): boolean
}

export interface InputHistoryStoreOptions {
  maxEntries?: number
  now?: () => number
  dedupeConsecutive?: boolean
}

const DEFAULT_MAX_ENTRIES = 500

export function createInputHistoryStore(
  options: InputHistoryStoreOptions = {},
): InputHistoryStore {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
  const now = options.now ?? (() => Date.now())
  const dedupeConsecutive = options.dedupeConsecutive ?? true

  let buffer: InputHistoryEntry[] = []
  // Cursor points at the entry currently displayed, or buffer.length when at head.
  let cursor = 0
  // Holds the user's in-progress input while browsing history, restored on forward-past-head.
  let workingCopy = ''

  return {
    push(text) {
      const trimmed = text.trim()
      if (trimmed.length === 0) return
      if (dedupeConsecutive && buffer.length > 0) {
        const prev = buffer[buffer.length - 1]
        if (prev && prev.text === trimmed) {
          cursor = buffer.length
          return
        }
      }
      buffer.push({ text: trimmed, submittedAtMs: now() })
      if (buffer.length > maxEntries) {
        const overflow = buffer.length - maxEntries
        buffer = buffer.slice(overflow)
      }
      cursor = buffer.length
      workingCopy = ''
    },
    back(current) {
      if (cursor === buffer.length) {
        workingCopy = current
      }
      if (cursor > 0) {
        cursor -= 1
      }
      const entry = buffer[cursor]
      return entry ? entry.text : current
    },
    forward(current) {
      if (cursor >= buffer.length) {
        return current
      }
      cursor += 1
      if (cursor === buffer.length) {
        const working = workingCopy
        workingCopy = ''
        return working
      }
      const entry = buffer[cursor]
      return entry ? entry.text : current
    },
    reset() {
      cursor = buffer.length
      workingCopy = ''
    },
    entries() {
      return buffer
    },
    size() {
      return buffer.length
    },
    atHead() {
      return cursor === buffer.length
    },
    atTail() {
      return cursor === 0 && buffer.length > 0
    },
  }
}

/**
 * Pure helper — scan back through history for an entry that starts with the
 * given prefix. Returns the matching entry's text, or null. The store is
 * not mutated; callers can use this for prefix-match navigation (e.g.
 * bash's reverse-i-search) without disturbing the main cursor.
 */
export function findMostRecentPrefixMatch(
  store: InputHistoryStore,
  prefix: string,
): string | null {
  if (prefix.length === 0) return null
  const list = store.entries()
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const entry = list[i]
    if (entry && entry.text.startsWith(prefix)) {
      return entry.text
    }
  }
  return null
}
