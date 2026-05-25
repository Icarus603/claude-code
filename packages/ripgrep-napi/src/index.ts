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
  /**
   * Globs in gitignore semantics, same as `rg --glob`: a bare pattern
   * (`*.ts`) matches at any depth, a leading `!` (`!.git`) excludes a
   * whole subtree. Pass the raw rg-style glob — the native side feeds it
   * straight to the `ignore` crate's OverrideBuilder. Do NOT pre-prefix
   * with `**​/`.
   */
  globs?: string[]
  /** `--type` filter, e.g. `['ts', 'py']`. Unknown names are ignored. */
  fileTypes?: string[]
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
  /** `-B`: leading context lines around each match. */
  beforeContext?: number
  /** `-A`: trailing context lines around each match. */
  afterContext?: number
  globs?: string[]
  fileTypes?: string[]
  hidden?: boolean
  noIgnore?: boolean
  /**
   * `-o` / `--only-matching`. Handled entirely JS-side in ripgrep.ts (it
   * re-scans each match's content with the pattern), NOT consumed by the
   * native module — napi-rs ignores unknown object fields. Declared here
   * so the ripgrep.ts adapter can pass it on the same options literal
   * without a TS2353 excess-property error.
   */
  onlyMatching?: boolean
}

interface ContentMatch {
  path: string
  /**
   * Line number, or absent. The native side's `Option<u32>::None` is
   * surfaced by napi-rs as `undefined` (NOT `null`) — callers comparing
   * against absence must use a loose `== null` check to catch both.
   */
  lineNumber: number | null | undefined
  content: string
  /**
   * True when the match's line exceeded `maxColumns` and its content was
   * suppressed (empty `content`). The file still counts as a match so
   * files-with-matches / count callers include it — mirrors `rg -l`/`-c`,
   * which list/count a file even when every match is on an over-long line.
   * Content-mode callers should filter these out.
   */
  columnTruncated: boolean
  /**
   * True when this entry is a CONTEXT line (`-A`/`-B`/`-C`), not a real
   * match. rg renders context with a `-` separator vs `:` for matches;
   * `-l`/`-c` modes ignore context entries. Content-mode formats them
   * with the `-` separator for rg parity.
   */
  isContext: boolean
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
