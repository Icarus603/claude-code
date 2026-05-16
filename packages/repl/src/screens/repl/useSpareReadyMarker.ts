/**
 * Spare-pool readiness signal.
 *
 * Source: ant 4774.js verbatim — `s1H.ready` flips to true when the
 * daemon roster reports the spare's sessionId, i.e. when the inner
 * REPL is fully mounted and registered. The spare-claim path
 * (`yvK`/`A7` gate) refuses to claim a spare until `ready === true`,
 * preventing the bracketed-paste injection from racing the inner
 * REPL's mount.
 *
 * ccb has no daemon roster. Equivalent: this hook (called once from
 * REPLView's render path) writes `<jobDir>/spare-ready.flag` once
 * the REPL has mounted enough for PromptInput's useInput to be
 * registered. ensureSpare polls for this marker before marking the
 * slot claimable. Without this gate, the claim's
 * `\x1B[200~hi\x1B[201~\r` arrives at the PTY before the input
 * listeners exist → tokens dropped → REPL idles with empty buffer
 * after attach ("無消息" symptom).
 */

import { useEffect } from 'react'

export function useSpareReadyMarker(): void {
  useEffect(() => {
    if (process.env.CCB_SPARE !== '1') return
    const jobDir = process.env.CLAUDE_JOB_DIR
    if (jobDir === undefined || jobDir === '') return
    void (async () => {
      try {
        const { writeFile, mkdir } = await import('node:fs/promises')
        const { join } = await import('node:path')
        await mkdir(jobDir, { recursive: true }).catch(() => undefined)
        await writeFile(join(jobDir, 'spare-ready.flag'), '').catch(
          () => undefined,
        )
      } catch {
        // best-effort
      }
    })()
  }, [])
}
