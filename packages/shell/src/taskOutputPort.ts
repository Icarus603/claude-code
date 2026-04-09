/**
 *
 */
export interface TaskOutputPort {
  readonly taskId: string
  readonly path: string
  readonly stdoutToFile: boolean
  readonly outputFileRedundant: boolean
  readonly outputFileSize: number

  writeStdout(data: string): void
  writeStderr(data: string): void

  getStdout(): Promise<string>
  getStderr(): string

  clear(): void
  spillToDisk(): void
  deleteOutputFile(): Promise<void>
  flush(): Promise<void>
}
