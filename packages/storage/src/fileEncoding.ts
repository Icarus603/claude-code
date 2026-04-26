// Extracted from file.ts to break the file ↔ fileReadCache import cycle:
// fileReadCache needs detectFileEncoding, file.ts needs fileReadCache.
// Putting detectFileEncoding in its own leaf module lets both depend on
// the same module without forming a cycle.

import { getFsImplementation, safeResolvePath } from '@claude-code/storage/fsOperations.js'
import { detectEncodingForResolvedPath } from './fileRead.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { isFsInaccessible } from '@claude-code/local-observability/errorHelpers.js'
import { logError } from '@claude-code/local-observability/logging'

export function detectFileEncoding(filePath: string): BufferEncoding {
  try {
    const fs = getFsImplementation()
    const { resolvedPath } = safeResolvePath(fs, filePath)
    return detectEncodingForResolvedPath(resolvedPath)
  } catch (error) {
    if (isFsInaccessible(error)) {
      logForDebugging(
        `detectFileEncoding failed for expected reason: ${(error as { code?: string }).code}`,
        { level: 'debug' },
      )
    } else {
      logError(error)
    }
    return 'utf8'
  }
}
