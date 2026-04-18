/**
 * V7 §10.3 facade — moved to `@claude-code/output/formatters/format`.
 *
 * Truncate helpers still live in ./truncate.ts (they depend on ink/stringWidth
 * which is out of scope for the output Wave-2 migration). Re-exported here
 * so callers that previously did `import { truncate } from 'src/utils/format.js'`
 * continue to work.
 */

export {
  formatDuration,
  formatFileSize,
  formatLogMetadata,
  formatNumber,
  formatRelativeTime,
  formatRelativeTimeAgo,
  formatResetText,
  formatResetTime,
  formatSecondsShort,
  formatTokens,
} from '@claude-code/output/formatters'

export {
  truncate,
  truncatePathMiddle,
  truncateStartToWidth,
  truncateToWidth,
  truncateToWidthNoEllipsis,
  wrapText,
} from './truncate.js'
