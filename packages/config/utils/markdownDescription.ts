/**
 * Extracts a description from markdown content.
 * Uses the first non-empty line as the description, or falls back to a default.
 *
 * Lives in config (not tool-registry) so config/plugin/_deps.ts can call it
 * statically — used to be in tool-registry/markdownConfigLoader.ts and was
 * lazy-required to avoid the config → tool-registry cycle.
 */
export function extractDescriptionFromMarkdown(
  content: string,
  defaultDescription: string = 'Custom item',
): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) {
      // If it's a header, strip the header prefix
      const headerMatch = trimmed.match(/^#+\s+(.+)$/)
      const text = headerMatch?.[1] ?? trimmed

      // Return the text, limited to reasonable length
      return text.length > 100 ? text.substring(0, 97) + '...' : text
    }
  }
  return defaultDescription
}
