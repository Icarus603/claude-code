import type ignore from 'ignore'

export function safelyIgnored(
  matcher: ReturnType<typeof ignore>,
  path: string,
): boolean {
  try {
    return matcher.ignores(path)
  } catch {
    return false
  }
}
