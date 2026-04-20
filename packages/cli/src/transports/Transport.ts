import type { StdoutMessage } from '@claude-code/headless-sdk/controlTypes.js'

export type Transport = {
  connect(): Promise<void>
  write(message: StdoutMessage): Promise<void>
  setOnData(callback: (data: string) => void): void
  setOnClose(callback: (closeCode?: number) => void): void
  close(): void
  setOnConnect?(callback: () => void): void
  getStateLabel?(): string
  getLastSequenceNum?(): number
}
