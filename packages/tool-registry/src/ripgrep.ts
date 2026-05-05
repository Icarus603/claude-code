/**
 * ripgrep — adapter from ccb's spawn-shaped legacy API to the in-process
 * `ripgrep-napi` native module.
 *
 * Call sites pre-date NAPI: they pass ripgrep flag arrays (`['--files',
 * '--hidden', '--glob', '*.md']`) and expect either `string[]` (one line
 * per result) or a streaming callback. We parse those flag arrays into
 * the typed options the NAPI surface accepts, run the search in-process,
 * and format results back into the legacy `path:line:content` shape that
 * existing parsers consume. The wire-format adapter is the *only* shim;
 * there's no spawn, no buffer pump, no EAGAIN retry, no SIGKILL
 * escalation. Those problems all belonged to subprocess management.
 *
 * The previous 693-LOC implementation is gone. Caller signatures are
 * preserved exactly so importers don't change.
 *
 * Sandbox note: `ripgrepCommand()` still returns a path-shaped config
 * because @anthropic-ai/sandbox-runtime takes rg as an external binary
 * for filesystem-deny enforcement on Linux. That single edge — opt-in,
 * Linux-only, ~rare — is handled by sandbox-adapter.ts and is the only
 * remaining consumer of the legacy "spawn rg as a subprocess" model.
 */
import memoize from 'lodash-es/memoize.js'
import { homedir } from 'os'
import * as path from 'path'
import {
  countFiles as napiCountFiles,
  findFiles as napiFindFiles,
  searchContent as napiSearchContent,
  searchStream as napiSearchStream,
  type FindFilesOptions,
  type SearchContentOptions,
} from 'ripgrep-napi'
import { logForDebugging } from '@claude-code/local-observability/debug.js'

/**
 * Thrown when a ripgrep call exceeds its timeout. Preserved for caller
 * compat — GrepTool inspects this type to disambiguate "search timed
 * out" from "search returned 0 matches" in user-facing error messages.
 */
export class RipgrepTimeoutError extends Error {
  constructor(
    message: string,
    public readonly partialResults: string[],
  ) {
    super(message)
    this.name = 'RipgrepTimeoutError'
  }
}

const DEFAULT_TIMEOUT_MS = 20_000

/**
 * Sandbox-runtime config. With NAPI ripgrep doing the actual work,
 * this is only consumed by the sandbox-runtime on Linux when
 * `sandbox.enabled` is true. macOS sandbox profile doesn't shell out
 * to rg; Windows doesn't support sandboxing. Returning the same shape
 * across platforms keeps callers branchless — sandbox-adapter.ts
 * decides whether to actually use the path.
 */
export function ripgrepCommand(): {
  rgPath: string
  rgArgs: string[]
  argv0?: string
} {
  return { rgPath: 'rg', rgArgs: [] }
}

/**
 * Reported by the doctor diagnostic.
 */
export function getRipgrepStatus(): {
  mode: 'system' | 'builtin' | 'embedded' | 'napi'
  path: string
  working: boolean | null
} {
  return { mode: 'napi', path: '<embedded ripgrep-napi>', working: true }
}

// ---------------------------------------------------------------------------
// Args parsing — translate legacy ripgrep CLI flag arrays to typed options.
// Switch table only; no surprise behavior. Unknown flags are ignored
// rather than rejected so future flag additions don't break callers.
// ---------------------------------------------------------------------------

interface ParsedArgs {
  /** True when the caller passed --files (file-listing mode, no pattern). */
  filesOnly: boolean
  /** Pattern (only meaningful when filesOnly is false). */
  pattern: string | null
  globs: string[]
  fileTypes: string[]
  hidden: boolean
  noIgnore: boolean
  follow: boolean
  maxDepth: number | null
  caseInsensitive: boolean
  literal: boolean
  multilineDotall: boolean
  maxColumns: number | null
  maxCountPerFile: number | null
  /** True for `-l` (files-with-matches) — caller expects file paths only. */
  filesWithMatchesOnly: boolean
  /** True for `-c` (count) — caller expects `path:count` lines. */
  countOnly: boolean
  /** True for `-n` (line numbers in output). */
  lineNumbers: boolean
  /** Sort by mtime descending. */
  sortModified: boolean
}

/**
 * Normalize a single ripgrep `--glob` pattern to a globset-compatible
 * shape. ripgrep treats glob patterns as gitignore-style with two
 * implicit conventions:
 *
 *   1. A pattern with no `/` matches at any depth (e.g. `.orphaned_at`
 *      → `**\/.orphaned_at`)
 *   2. A trailing `/` anchors to a directory and matches its contents
 *      (e.g. `.git/` → `.git/**`)
 *
 * globset crate doesn't apply either implicitly. Without these shims,
 * ccb call sites that worked under spawn-based ripgrep silently return
 * zero results.
 */
function normalizeRipgrepGlob(pattern: string): string {
  const negated = pattern.startsWith('!')
  let body = negated ? pattern.slice(1) : pattern
  if (body.endsWith('/')) {
    body = body + '**'
  } else if (!body.includes('/')) {
    body = '**/' + body
  }
  return negated ? '!' + body : body
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = {
    filesOnly: false,
    pattern: null,
    globs: [],
    fileTypes: [],
    hidden: false,
    noIgnore: false,
    follow: false,
    maxDepth: null,
    caseInsensitive: false,
    literal: false,
    multilineDotall: false,
    maxColumns: null,
    maxCountPerFile: null,
    filesWithMatchesOnly: false,
    countOnly: false,
    lineNumbers: false,
    sortModified: false,
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    switch (a) {
      case '--files':
        out.filesOnly = true
        break
      case '--hidden':
        out.hidden = true
        break
      case '--no-ignore':
      case '--no-ignore-vcs':
        out.noIgnore = true
        break
      case '--follow':
        out.follow = true
        break
      case '--multiline-dotall':
      case '-U':
        out.multilineDotall = true
        break
      case '-i':
        out.caseInsensitive = true
        break
      case '-F':
        out.literal = true
        break
      case '-l':
        out.filesWithMatchesOnly = true
        break
      case '-c':
        out.countOnly = true
        break
      case '-n':
      case '--line-number':
        out.lineNumbers = true
        break
      case '--no-heading':
        // we never produce headings, no-op
        break
      case '--glob':
        if (i + 1 < args.length) {
          out.globs.push(normalizeRipgrepGlob(args[++i]!))
        }
        break
      case '--type':
        if (i + 1 < args.length) out.fileTypes.push(args[++i]!)
        break
      case '--max-depth':
        if (i + 1 < args.length) out.maxDepth = parseInt(args[++i]!, 10)
        break
      case '--max-columns':
        if (i + 1 < args.length) out.maxColumns = parseInt(args[++i]!, 10)
        break
      case '-m':
        if (i + 1 < args.length) out.maxCountPerFile = parseInt(args[++i]!, 10)
        break
      case '--sort':
        if (i + 1 < args.length && args[i + 1] === 'modified') out.sortModified = true
        i++ // consume value
        break
      case '-e':
        if (i + 1 < args.length) out.pattern = args[++i]!
        break
      case '-A':
      case '-B':
      case '-C':
        // Context lines: consume the numeric arg. We don't currently
        // surface them via NAPI — none of ccb's actual call sites
        // depend on context for correctness (GrepTool requests them
        // but only for human-facing output, which now goes through
        // searchContent's structured matches). Skip silently.
        if (i + 1 < args.length) i++
        break
      default:
        // First non-flag argument that isn't preceded by -e is the pattern.
        if (!a.startsWith('-') && out.pattern === null && !out.filesOnly) {
          out.pattern = a
        }
        break
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Public functions, preserved signatures.
// ---------------------------------------------------------------------------

/**
 * Buffered ripgrep call. Returns one line per result.
 *
 * For `--files` mode: each line is an absolute file path.
 * For content search (-l mode): each line is a file path.
 * For content search (-c mode): each line is `path:count`.
 * For content search (default): each line is `path:line:content`.
 */
export async function ripGrep(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  const parsed = parseArgs(args)

  if (parsed.filesOnly) {
    return runFindFiles(parsed, target, abortSignal)
  }
  if (parsed.pattern === null) {
    // No pattern + no --files: ill-formed, but legacy callers never
    // hit this. Return empty rather than throw.
    return []
  }
  return runSearch(parsed, target, abortSignal)
}

/**
 * Streaming search. `onLines` is called with arrays of `path:line:content`
 * formatted strings as matches arrive. Used by GlobalSearchDialog.
 */
export async function ripGrepStream(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  onLines: (lines: string[]) => void,
): Promise<void> {
  const parsed = parseArgs(args)
  if (parsed.pattern === null) {
    return
  }

  const opts: SearchContentOptions = {
    root: target,
    pattern: parsed.pattern,
    caseInsensitive: parsed.caseInsensitive,
    literal: parsed.literal,
    multilineDotall: parsed.multilineDotall,
    maxColumns: parsed.maxColumns ?? undefined,
    maxCountPerFile: parsed.maxCountPerFile ?? undefined,
    globs: parsed.globs.length > 0 ? parsed.globs : undefined,
    hidden: parsed.hidden,
    noIgnore: parsed.noIgnore,
  }

  return new Promise<void>(resolve => {
    let cancelled = false
    const handle = napiSearchStream(
      opts,
      line => {
        if (!cancelled) onLines([line])
      },
      () => resolve(),
    )
    abortSignal.addEventListener(
      'abort',
      () => {
        cancelled = true
        handle.cancel()
      },
      { once: true },
    )
  })
}

/**
 * Memoized file count, rounded to a power of 10 for telemetry.
 * Callers don't need exact counts — they want anonymized magnitudes
 * (1, 10, 100, 1000, ...).
 */
export const countFilesRoundedRg = memoize(
  async (
    dirPath: string,
    abortSignal: AbortSignal,
    ignorePatterns: string[] = [],
  ): Promise<number | undefined> => {
    // Skip the home directory wholesale: walking it triggers macOS TCC
    // permission dialogs (Desktop, Downloads, Documents). Same guard as
    // ant upstream — we never want to drag the user through OS prompts
    // for a telemetry counter.
    if (path.resolve(dirPath) === path.resolve(homedir())) {
      return undefined
    }
    if (abortSignal.aborted) return undefined
    try {
      const opts: FindFilesOptions = {
        root: dirPath,
        hidden: true,
        globs: ignorePatterns.map(p => `!${p}`),
      }
      const count = napiCountFiles(opts)
      if (count === 0) return 0
      const power = Math.pow(10, Math.floor(Math.log10(count)))
      return Math.round(count / power) * power
    } catch (e) {
      logForDebugging(`countFilesRoundedRg failed for ${dirPath}: ${e}`)
      return undefined
    }
  },
  (dirPath, _signal, ignorePatterns = []) =>
    `${dirPath}|${ignorePatterns.join(',')}`,
)

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

async function runFindFiles(
  parsed: ParsedArgs,
  target: string,
  signal: AbortSignal,
): Promise<string[]> {
  const opts: FindFilesOptions = {
    root: target,
    globs: parsed.globs.length > 0 ? parsed.globs : undefined,
    hidden: parsed.hidden,
    noIgnore: parsed.noIgnore,
    follow: parsed.follow,
    maxDepth: parsed.maxDepth ?? undefined,
    sortModified: parsed.sortModified,
  }
  return raceTimeout(
    () => napiFindFiles(opts),
    DEFAULT_TIMEOUT_MS,
    signal,
    [],
  )
}

async function runSearch(
  parsed: ParsedArgs,
  target: string,
  signal: AbortSignal,
): Promise<string[]> {
  const opts: SearchContentOptions = {
    root: target,
    pattern: parsed.pattern!,
    caseInsensitive: parsed.caseInsensitive,
    literal: parsed.literal,
    multilineDotall: parsed.multilineDotall,
    maxColumns: parsed.maxColumns ?? undefined,
    maxCountPerFile: parsed.maxCountPerFile ?? undefined,
    globs: parsed.globs.length > 0 ? parsed.globs : undefined,
    hidden: parsed.hidden,
    noIgnore: parsed.noIgnore,
  }

  const matches = await raceTimeout(
    () => napiSearchContent(opts),
    DEFAULT_TIMEOUT_MS,
    signal,
    [],
  )

  if (parsed.filesWithMatchesOnly) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const m of matches) {
      if (!seen.has(m.path)) {
        seen.add(m.path)
        out.push(m.path)
      }
    }
    return out
  }

  if (parsed.countOnly) {
    const counts = new Map<string, number>()
    for (const m of matches) {
      counts.set(m.path, (counts.get(m.path) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([p, c]) => `${p}:${c}`)
  }

  // Content mode: format `path:line:content`. All callers parse this
  // exact shape (see GrepTool, GlobalSearchDialog).
  return matches.map(
    m => `${m.path}:${m.lineNumber ?? 0}:${m.content}`,
  )
}

/**
 * Promise.race the synchronous NAPI call against a timeout. NAPI calls
 * are synchronous from JS's perspective — we wrap them in a microtask
 * so the timeout has a chance to fire if the search blocks unexpectedly.
 * Caller-provided AbortSignal gives an additional escape hatch.
 *
 * Note: synchronous NAPI calls block the event loop while running, so
 * "timeout" really only protects against the racing promise resolving
 * after the timer has fired. For true cancellation mid-search use
 * ripGrepStream + abortSignal.
 */
async function raceTimeout<T>(
  fn: () => T,
  timeoutMs: number,
  signal: AbortSignal,
  partialFallback: T,
): Promise<T> {
  if (signal.aborted) return partialFallback
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new RipgrepTimeoutError(
          `ripgrep call exceeded ${timeoutMs}ms`,
          partialFallback as unknown as string[],
        ),
      )
    }, timeoutMs)
    queueMicrotask(() => {
      try {
        const result = fn()
        clearTimeout(timer)
        resolve(result)
      } catch (e) {
        clearTimeout(timer)
        reject(e)
      }
    })
  })
}
