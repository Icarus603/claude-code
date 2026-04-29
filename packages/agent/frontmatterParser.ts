// Forward shim — moved to @claude-code/config/frontmatterParser to break the
// agent → config → agent import cycle that forced lazy-require fallbacks
// in config/plugin/_deps.ts. Re-exported for back-compat with existing
// callers; new code should import from '@claude-code/config/frontmatterParser'.
export {
  type FrontmatterData,
  type ParsedMarkdown,
  type FrontmatterShell,
  FRONTMATTER_REGEX,
  parseFrontmatter,
  splitPathInFrontmatter,
  parsePositiveIntFromFrontmatter,
  coerceDescriptionToString,
  parseBooleanFrontmatter,
  parseShellFrontmatter,
} from '@claude-code/config/frontmatterParser.js'
