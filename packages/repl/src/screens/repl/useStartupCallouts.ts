import { useState } from 'react'
import { shouldShowEffortCallout } from '@claude-code/repl/components/EffortCallout.js'
import { shouldShowDesktopUpsellStartup } from '@claude-code/repl/components/DesktopUpsell/DesktopUpsellStartup.js'

const shouldShowAntModelSwitch: () => boolean =
  process.env.USER_TYPE === 'ant'
    ? require('@claude-code/repl/components/AntModelSwitchCallout.js').shouldShowModelSwitchCallout
    : () => false

/**
 * Three independent "show this callout once at startup" gates: ant-only
 * model switch, effort tier, and desktop upsell. Each captures its
 * boolean at mount and is dismissed via its setter.
 *
 * V7 §3.3 — extracted from REPLView.tsx. Each useState was previously
 * inlined back-to-back in the host; bundling here keeps the host's
 * state declarations focused on REPL-specific cells.
 */
export function useStartupCallouts(mainLoopModel: unknown): {
  showModelSwitchCallout: boolean
  setShowModelSwitchCallout: (next: boolean) => void
  showEffortCallout: boolean
  setShowEffortCallout: (next: boolean) => void
  showDesktopUpsellStartup: boolean
  setShowDesktopUpsellStartup: (next: boolean) => void
} {
  const [showModelSwitchCallout, setShowModelSwitchCallout] = useState(() => {
    if (process.env.USER_TYPE === 'ant') return shouldShowAntModelSwitch()
    return false
  })
  const [showEffortCallout, setShowEffortCallout] = useState(() =>
    shouldShowEffortCallout(mainLoopModel as Parameters<typeof shouldShowEffortCallout>[0]),
  )
  const [showDesktopUpsellStartup, setShowDesktopUpsellStartup] = useState(() =>
    shouldShowDesktopUpsellStartup(),
  )

  return {
    showModelSwitchCallout,
    setShowModelSwitchCallout,
    showEffortCallout,
    setShowEffortCallout,
    showDesktopUpsellStartup,
    setShowDesktopUpsellStartup,
  }
}
