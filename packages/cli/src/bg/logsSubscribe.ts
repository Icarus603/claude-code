/**
 * Daemon-routed log subscribe — used by `ccb logs <short> --follow`
 * for pty-mode running jobs when the bg daemon is alive.
 *
 * Ports ant 4640.js's `vX_()` log subscribe handler: we send the
 * `subscribe` op, print snapshot, then live `data` frames. On the
 * caller side we keep the process alive with a long unref interval
 * so the streaming connection stays open until the worker settles
 * (status≠running) or the user Ctrl-Cs.
 *
 * Falls back to file polling when daemon is unreachable; that
 * fallback lives in bg.ts.
 *
 * @dynamicRequire
 */

import { daemonSubscribe } from '@claude-code/daemon/daemonClient.js'

interface LogsSubscribeOpts {
  short: string
  /** Called every 500ms; should return current job status string. */
  pollStatus: () => string
}

export function followLogsViaDaemon(opts: LogsSubscribeOpts): void {
  let done = false
  const finish = (status: string): void => {
    if (done) return
    done = true
    process.stdout.write(`\n[job ${opts.short} ${status}]\n`)
    process.exit(0)
  }
  const dispose = daemonSubscribe(
    'subscribe',
    { short: opts.short },
    msg => {
      const m = msg as Record<string, unknown>
      if (m.type === 'snapshot') {
        const tail = (m.streamTail as string[]) ?? []
        process.stdout.write(tail.join(''))
      } else if (m.type === 'data') {
        process.stdout.write((m.data as string) ?? '')
      }
    },
    () => finish(opts.pollStatus()),
  )
  const watch = setInterval(() => {
    const status = opts.pollStatus()
    if (status !== 'running') {
      dispose()
      finish(status)
    }
  }, 500)
  watch.unref()
  setInterval(() => {}, 1 << 30).unref()
}
