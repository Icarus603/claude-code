/**
 * Read the last N lines of a (potentially huge) log file without
 * slurping the whole thing into memory. Reads back in 64 KB chunks
 * until the requested newline count is reached. Used by `ccb logs
 * --tail N` and `ccb attach`.
 *
 * Extracted from bg.ts for the file-size budget + isolated test
 * coverage. The trailing-newline + chunk-boundary arithmetic is
 * subtle enough to warrant a regression suite (see __tests__/bg.test.ts).
 *
 * @dynamicRequire
 */

import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
} from 'node:fs'

/** @dynamicRequire */
export function tailFile(path: string, lines: number): string {
  if (!existsSync(path) || lines <= 0) return ''
  const stat = statSync(path)
  if (stat.size === 0) return ''
  const CHUNK = 64 * 1024
  const fd = openSync(path, 'r')
  let collected = Buffer.alloc(0)
  let pos = stat.size
  // Read backwards from EOF until we've collected enough newlines to
  // guarantee the slice below has the requested tail count, or we hit
  // BOF. We need (lines + 1) newlines so the slice can drop the partial
  // leading line — hitting BOF means we've already got the whole file.
  let newlines = 0
  try {
    while (pos > 0 && newlines <= lines) {
      const readSize = Math.min(CHUNK, pos)
      pos -= readSize
      const chunk = Buffer.alloc(readSize)
      readSync(fd, chunk, 0, readSize, pos)
      collected = Buffer.concat([chunk, collected])
      newlines = 0
      for (let i = 0; i < collected.length; i++) {
        if (collected[i] === 0x0a) newlines++
      }
    }
  } finally {
    closeSync(fd)
  }
  const text = collected.toString('utf8')
  // Split on `\n`. A file ending in `\n` produces a trailing empty
  // element which counts as one "line"; keep the math consistent by
  // dropping it before slicing, then re-add the terminator if needed.
  const hadTrailingNewline = text.endsWith('\n')
  const body = hadTrailingNewline ? text.slice(0, -1) : text
  const arr = body.split('\n')
  if (arr.length <= lines) return text
  const tail = arr.slice(arr.length - lines).join('\n')
  return hadTrailingNewline ? tail + '\n' : tail
}
