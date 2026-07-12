import type ignore from 'ignore'

type Matcher = ReturnType<typeof ignore>

export function addIgnorePatterns(matcher: Matcher, patterns: string): boolean {
  try {
    matcher.add(patterns)
    return true
  } catch {
    return false
  }
}

export function safelyFilterIgnored(matcher: Matcher, paths: string[]): string[] {
  return paths.filter(path => {
    try {
      return !matcher.ignores(path)
    } catch {
      return true
    }
  })
}
