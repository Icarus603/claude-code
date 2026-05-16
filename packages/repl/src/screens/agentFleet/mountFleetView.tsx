/**
 * mountFleetView — Ink render lifecycle wrapper around `<FleetView>`.
 *
 * Source: ant Ot3 (5092.js:3839-3980) — owns the async render loop,
 * unmount/remount when attaching to a job, return-to-fleet after detach.
 *
 * For Phase 8 we expose a single async entrypoint that:
 *   - renders FleetView in an alternate-screen Ink instance
 *   - awaits exit via onQuit / ctrl+c
 *   - returns when the user leaves the fleet view
 *
 * Job attach (left-arrow loop to dispatch into a PTY session) is
 * deferred to a Phase 8 follow-up; the immediate goal is "ccb agents
 * launches the dashboard and exits cleanly".
 */

import type React from 'react'
import { createElement } from 'react'

import { VoiceProvider } from '@claude-code/voice/voiceContext.js'

import { FleetView, type FleetViewProps } from './FleetView.js'

export interface InkRootLike {
  render: (node: React.ReactNode) => void
  unmount: () => void
  waitUntilExit: () => Promise<void>
}

export interface MountFleetViewOptions extends Omit<FleetViewProps, 'onQuit'> {
  /**
   * Pre-constructed Ink root (the caller awaits `createRoot()` and
   * passes the result). mountFleetView calls `.render(<FleetView/>)`.
   */
  root: InkRootLike
}

/**
 * Source: ant Ot3 (5092.js:3839).
 *
 * Wraps FleetView in VoiceProvider because the prompt-area voice cascade
 * (warmup hint / indicator / audio meter) subscribes via useVoiceState.
 * `ccb agents` is a standalone TUI entrypoint that doesn't inherit the
 * REPL's provider tree, so we mount a fresh default VoiceProvider here
 * — voiceState starts 'idle', UI renders nothing for voice until/unless
 * the user triggers it from inside the fleet view.
 */
export async function mountFleetView(options: MountFleetViewOptions): Promise<void> {
  return new Promise<void>(resolve => {
    options.root.render(
      createElement(
        VoiceProvider,
        null,
        createElement(FleetView, {
          versionLabel: options.versionLabel,
          modelLabel: options.modelLabel,
          cwdLabel: options.cwdLabel,
          currentSessionId: options.currentSessionId,
          seedJobs: options.seedJobs,
          prCache: options.prCache,
          onAttach: options.onAttach,
          onQuit: () => {
            options.root.unmount()
            resolve()
          },
        }),
      ),
    )
    void options.root.waitUntilExit().then(() => resolve())
  })
}
