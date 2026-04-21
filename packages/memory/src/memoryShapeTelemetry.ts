// Memory-shape telemetry — no-op stub. Real implementation records which
// memories the recall algorithm considered vs selected, and shape of
// memory-writing calls. Kept as a stub so feature-flagged callers compile.

import type { MemoryScope } from '@claude-code/memory/memoryFileDetection'

type MemoryHeaderLike = {
  filename: string
  filePath: string
  mtimeMs: number
  description: string | null
  type: unknown
}

export const logMemoryRecallShape: (
  memories: MemoryHeaderLike[],
  selected: MemoryHeaderLike[],
) => void = () => {}

export const logMemoryWriteShape: (
  toolName: string,
  toolInput: Record<string, unknown>,
  filePath: string,
  scope: MemoryScope,
) => void = () => {}
