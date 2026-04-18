/**
 * @claude-code/config/env/_deps
 *
 * Setter-based dependency injection for the env subsurface. Used only by
 * `paths.ts` and `dynamic.ts` (the two env modules with real cross-cutting
 * needs). Small & self-contained to keep the env surface independently
 * testable.
 */

// ---------------------------------------------------------------------------
// fs implementation — for path existence / read-file probes
// ---------------------------------------------------------------------------

export type EnvFsImpl = {
  existsSync(path: string): boolean
  readFileSync(path: string, options: { encoding: 'utf8' }): string
}

let _fs: EnvFsImpl = {
  existsSync: p => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('node:fs') as typeof import('node:fs')).existsSync(p)
  },
  readFileSync: (p, opts) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('node:fs') as typeof import('node:fs')).readFileSync(
      p,
      opts,
    ) as string
  },
}

export function getEnvFsImplementation(): EnvFsImpl {
  return _fs
}

export function setEnvFsImplementationFn(fs: EnvFsImpl): void {
  _fs = fs
}

// ---------------------------------------------------------------------------
// oauth file suffix — `.claude${fileSuffixForOauthConfig()}.json`
// ---------------------------------------------------------------------------

let _fileSuffixForOauthConfig: () => string = () => ''

export function fileSuffixForOauthConfig(): string {
  return _fileSuffixForOauthConfig()
}

export function setFileSuffixForOauthConfigFn(fn: () => string): void {
  _fileSuffixForOauthConfig = fn
}

// ---------------------------------------------------------------------------
// bun runtime probe — distinguishes bundled bun binary from plain node
// ---------------------------------------------------------------------------

let _isRunningWithBun: () => boolean = () => process.versions.bun !== undefined

export function isRunningWithBun(): boolean {
  return _isRunningWithBun()
}

export function setIsRunningWithBunFn(fn: () => boolean): void {
  _isRunningWithBun = fn
}

// ---------------------------------------------------------------------------
// executable detection — `which(cmd)` + `findExecutable(cmd, paths)`
// ---------------------------------------------------------------------------

let _which: (command: string) => Promise<string | null> = async () => null

export function which(command: string): Promise<string | null> {
  return _which(command)
}

export function setWhichFn(fn: (command: string) => Promise<string | null>): void {
  _which = fn
}

let _findExecutable: (
  name: string,
  paths: string[],
) => { cmd: string } = () => ({ cmd: '' })

export function findExecutable(
  name: string,
  paths: string[],
): { cmd: string } {
  return _findExecutable(name, paths)
}

export function setFindExecutableFn(
  fn: (name: string, paths: string[]) => { cmd: string },
): void {
  _findExecutable = fn
}

// ---------------------------------------------------------------------------
// dynamic env probes (used by dynamic.ts)
// ---------------------------------------------------------------------------

let _execFileNoThrow: (
  cmd: string,
  args: string[],
) => Promise<{ code: number; stdout?: string; stderr?: string }> =
  async () => ({ code: -1 })

export function execFileNoThrow(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout?: string; stderr?: string }> {
  return _execFileNoThrow(cmd, args)
}

export function setExecFileNoThrowFn(
  fn: (
    cmd: string,
    args: string[],
  ) => Promise<{ code: number; stdout?: string; stderr?: string }>,
): void {
  _execFileNoThrow = fn
}

let _getAncestorCommandsAsync: (
  pid: number,
  maxDepth: number,
) => Promise<string[]> = async () => []

export function getAncestorCommandsAsync(
  pid: number,
  maxDepth: number,
): Promise<string[]> {
  return _getAncestorCommandsAsync(pid, maxDepth)
}

export function setGetAncestorCommandsAsyncFn(
  fn: (pid: number, maxDepth: number) => Promise<string[]>,
): void {
  _getAncestorCommandsAsync = fn
}
