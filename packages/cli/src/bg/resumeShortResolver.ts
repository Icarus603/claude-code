/**
 * `--resume <bg-short>`: when the user passes an 8-hex-char value to
 * `--resume`, ant 4649.js kJK detects it as a bg job short id and asks
 * the daemon for the matching sessionId, then resumes that session.
 * ccb mirrors with this helper, called from mode-dispatch.ts.
 *
 * Returns the resolved sessionId if the short was a known bg job;
 * returns undefined if the value isn't a short or the daemon doesn't
 * know about it (fall through to existing UUID/title resolution).
 *
 * @dynamicRequire
 */

const SHORT_ID_PATTERN = /^[0-9a-f]{8}$/i

export async function resolveBgShortToSessionId(
  resumeArg: unknown,
): Promise<string | undefined> {
  if (typeof resumeArg !== 'string') return undefined
  const short = resumeArg.trim().toLowerCase()
  if (!SHORT_ID_PATTERN.test(short)) return undefined
  try {
    const { isDaemonAlive, daemonList } = await import('./daemonAdapter.js')
    if (!(await isDaemonAlive())) return undefined
    const r = await daemonList()
    if (!r.ok) return undefined
    const jobs = (r as Record<string, unknown>).jobs as
      | Array<Record<string, unknown>>
      | undefined
    const job = jobs?.find(
      j => (j.short as string)?.toLowerCase() === short,
    )
    return job?.sessionId as string | undefined
  } catch {
    return undefined
  }
}
