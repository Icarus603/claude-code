/**
 * Shared utilities for expanding environment variables in MCP server configurations
 */

/**
 * Expand environment variables in a string value
 * Handles ${VAR} and ${VAR:-default} syntax
 * @returns Object with expanded string and list of missing variables
 */
export function expandEnvVarsInString(value: string): {
  expanded: string
  missingVars: string[]
} {
  const missingVars: string[] = []

  const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varContent) => {
    // Find the FIRST `:-` and split there. Naive `split(':-', 2)` discards
    // anything after the second element, so `${A:-foo:-bar}` would lose
    // `:-bar` from the default. Use indexOf + slice to keep the rest verbatim.
    const sepIdx = varContent.indexOf(':-')
    const varName = sepIdx === -1 ? varContent : varContent.slice(0, sepIdx)
    const defaultValue =
      sepIdx === -1 ? undefined : varContent.slice(sepIdx + 2)
    const envValue = process.env[varName]

    if (envValue !== undefined) {
      return envValue
    }
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // Track missing variable for error reporting
    missingVars.push(varName)
    // Return original if not found (allows debugging but will be reported as error)
    return match
  })

  return {
    expanded,
    missingVars,
  }
}
