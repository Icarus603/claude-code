/**
 * V7 §10.3 facade — moved to `@claude-code/output/capture/ansi-to-svg`.
 */

export type {
  AnsiColor,
  AnsiToSvgOptions,
  ParsedLine,
  TextSpan,
} from '@claude-code/output/capture'
export {
  ansiToSvg,
  DEFAULT_BG,
  DEFAULT_FG,
  parseAnsi,
} from '@claude-code/output/capture'
