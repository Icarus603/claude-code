import ignore from 'ignore'
import picomatch from 'picomatch'

export function safePicomatch(
  path: string,
  patterns: string[],
  options: { dot: boolean },
): boolean {
  try {
    return picomatch.isMatch(path, patterns, options)
  } catch {
    return false
  }
}

export function safeIgnoreMatch(patterns: string[], path: string): boolean {
  try {
    return ignore().add(patterns).ignores(path)
  } catch {
    return false
  }
}
