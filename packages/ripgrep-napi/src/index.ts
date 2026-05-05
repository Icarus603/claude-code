/**
 * ripgrep-napi — in-process ripgrep, exposed as a Bun-loadable native
 * module. Backed by the rust crate at ../native (grep-searcher,
 * grep-regex, ignore, globset; pinned to ripgrep 14.1.1's versions).
 *
 * Resolution: bun's bundler detects literal `require('./vendor/<plat>/...node')`
 * calls and embeds the .node into the standalone binary's __BUN segment.
 * Same load-bearing pattern as packages/image-processor-napi/src/index.ts —
 * keep these as plain string literals; templates / variables / helpers
 * defeat the bundler's static analysis and the .node won't ship.
 *
 * Three primitives:
 *   findFiles(opts)    → Promise<string[]>      file enumeration
 *   searchContent(opts) → Promise<ContentMatch[]> buffered regex search
 *   searchStream(opts, onMatch, onDone) → CancelHandle   streaming search
 *
 * Plus countFiles(opts) → Promise<number>, a thin convenience over findFiles().
 *
 * The buffered primitives are async because the underlying `ignore::Walk`
 * is blocking I/O — a sync NAPI call would freeze Bun's event loop for
 * the entire walk (~2.5s on a 1.7M-file home directory). The Rust side
 * uses `napi::tokio_runtime::spawn_blocking` so the work runs on the
 * blocking pool, leaving the JS main thread free to render Ink frames
 * and process keystrokes.
 *
 * `searchStream` already runs on its own `std::thread` and reports back
 * via `ThreadsafeFunction`, so it stays on the same shape.
 */

interface CancelHandle {
  cancel(): void
}

interface FindFilesOptions {
  root: string
  globs?: string[]
  hidden?: boolean
  noIgnore?: boolean
  follow?: boolean
  maxDepth?: number
  sortModified?: boolean
}

interface SearchContentOptions {
  root: string
  pattern: string
  caseInsensitive?: boolean
  literal?: boolean
  multilineDotall?: boolean
  maxColumns?: number
  maxCountPerFile?: number
  globs?: string[]
  hidden?: boolean
  noIgnore?: boolean
}

interface ContentMatch {
  path: string
  lineNumber: number | null
  content: string
}

interface NativeBinding {
  findFiles(opts: FindFilesOptions): Promise<string[]>
  countFiles(opts: FindFilesOptions): Promise<number>
  searchContent(opts: SearchContentOptions): Promise<ContentMatch[]>
  searchStream(
    opts: SearchContentOptions,
    onMatch: (err: Error | null, line: string) => void,
    onDone: (err: Error | null, value: undefined) => void,
  ): CancelHandle
}

let cached: NativeBinding | null = null

function load(): NativeBinding {
  if (cached !== null) return cached

  // Plain literal `require()` calls so bun's bundler embeds each .node.
  // The branch table is small enough to keep all five literals visible
  // without indirection.
  let mod: unknown
  try {
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/arm64-darwin/ripgrep.node')
    } else if (process.platform === 'darwin' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-darwin/ripgrep.node')
    } else if (process.platform === 'linux' && process.arch === 'arm64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/arm64-linux/ripgrep.node')
    } else if (process.platform === 'linux' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-linux/ripgrep.node')
    } else if (process.platform === 'win32' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-win32/ripgrep.node')
    } else {
      throw new Error(
        `ripgrep-napi: unsupported platform ${process.platform}-${process.arch}`,
      )
    }
  } catch (e) {
    throw new Error(
      `ripgrep-napi: failed to load native module for ${process.platform}-${process.arch}: ${(e as Error).message}`,
    )
  }

  cached = mod as NativeBinding
  return cached
}

export function findFiles(opts: FindFilesOptions): Promise<string[]> {
  return load().findFiles(opts)
}

export function countFiles(opts: FindFilesOptions): Promise<number> {
  return load().countFiles(opts)
}

export function searchContent(
  opts: SearchContentOptions,
): Promise<ContentMatch[]> {
  return load().searchContent(opts)
}

export function searchStream(
  opts: SearchContentOptions,
  onMatch: (line: string) => void,
  onDone: () => void,
): CancelHandle {
  return load().searchStream(
    opts,
    (err, line) => {
      if (!err) onMatch(line)
    },
    err => {
      if (!err) onDone()
    },
  )
}

export type {
  CancelHandle,
  ContentMatch,
  FindFilesOptions,
  SearchContentOptions,
}
