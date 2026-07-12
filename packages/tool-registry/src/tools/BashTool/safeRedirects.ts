export function hasUnsafeRedirectWithCd(
  hasCd: boolean,
  redirections: Array<{ target: string }>,
): boolean {
  return hasCd && redirections.some(({ target }) => target !== '/dev/null')
}
