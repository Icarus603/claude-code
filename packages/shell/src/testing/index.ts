/**
 * @claude-code/shell/testing
 *
 * V7 §9.11 — public in-memory seams for shell package tests.
 * Must NOT import from ../internal/.
 */
import type {
  ExecResult,
  ShellCommand,
  ShellExecContext,
  SnapshotContext,
} from '../index.js'

/**
 * Minimal mutable execution context for hermetic shell tests.
 */
export class StubShellExecContext implements ShellExecContext {
  private cwd = process.cwd()
  private readonly events: Array<{ name: string; data: Record<string, unknown> }> = []

  getCwd(): string {
    return this.cwd
  }

  setCwd(path: string): void {
    this.cwd = path
  }

  getOriginalCwd(): string {
    return process.cwd()
  }

  getSessionId(): string {
    return 'test-session'
  }

  logEvent(name: string, data: Record<string, unknown>): void {
    this.events.push({ name, data })
  }

  logForDebugging(_msg: string): void {}

  getSessionEnvVars(): Iterable<[string, string]> {
    return []
  }

  async getSessionEnvironmentScript(): Promise<string> {
    return ''
  }

  getPlatform(): 'macos' | 'linux' | 'windows' {
    return process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'macos'
        : 'linux'
  }

  async which(_command: string): Promise<string | null> {
    return null
  }

  getTaskOutputDir(): string {
    return '/tmp'
  }

  generateTaskId(prefix: string): string {
    return `${prefix}-1`
  }

  getMaxTaskOutputBytes(): number {
    return 1024 * 1024
  }

  getLoggedEvents(): ReadonlyArray<{ name: string; data: Record<string, unknown> }> {
    return this.events
  }
}

/**
 * Snapshot context stub for shell snapshot tests.
 */
export class StubSnapshotContext implements SnapshotContext {
  private cwd = process.cwd()

  logEvent(_name: string, _data: Record<string, unknown>): void {}
  logForDebugging(_msg: string): void {}
  logError(_error: unknown): void {}
  getPlatform(): 'macos' | 'linux' | 'windows' {
    return process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'macos'
        : 'linux'
  }
  getCwd(): string {
    return this.cwd
  }
  getClaudeConfigHomeDir(): string {
    return '/tmp/claude'
  }
  async pathExists(_path: string): Promise<boolean> {
    return false
  }
  getFs(): { unlink(path: string): Promise<void>; readdir(path: string): Promise<string[]> } {
    return {
      unlink: async () => {},
      readdir: async () => [],
    }
  }
  registerCleanup(_fn: () => Promise<void>): void {}
  hasEmbeddedSearchTools(): boolean {
    return false
  }
  embeddedSearchToolsBinaryPath(): string {
    return ''
  }
  ripgrepCommand(): { rgPath: string; rgArgs: string[]; argv0?: string } {
    return { rgPath: 'rg', rgArgs: [] }
  }
  subprocessEnv(): Record<string, string | undefined> {
    return {}
  }
}

/**
 * Completed shell command stub with deterministic result.
 */
export function createCompletedShellCommand(
  result: ExecResult,
): ShellCommand {
  return {
    background: () => false,
    result: Promise.resolve(result),
    kill: () => {},
    status: 'completed',
    cleanup: () => {},
  }
}
