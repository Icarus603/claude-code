/**
 * Permission Explanation UI
 *
 * Renders the `ctrl+e` LLM command explainer inside a permission confirmation
 * dialog. Three parts (ported from ant v2.1.150 5236.js):
 *
 * - `usePermissionExplainer` (ant Wy6) — wires the `confirm:toggleExplanation`
 *   keybinding, kicks off the one-shot LLM call on first toggle, and aborts
 *   the in-flight request on unmount.
 * - `PermissionExplanation` (ant Zy6) — Suspense container. Shows a loading
 *   shimmer while the promise resolves.
 * - `PermissionExplanationContent` (ant APO) — renders the resolved
 *   explanation / reasoning / risk line.
 *
 * The LLM call is `.catch(() => null)` and abortable, so it can never crash
 * the permission dialog.
 */

import React, { Suspense, use, useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text } from '@anthropic/ink'
import { useKeybinding } from '@anthropic/ink/keybindings'
import { logEvent } from '@claude-code/local-observability'
import { useShortcutDisplay } from '@claude-code/repl/keybindings/useShortcutDisplay.js'
import { ShimmerChar } from '@claude-code/repl/components/Spinner/ShimmerChar.js'
import { useShimmerAnimation } from '@claude-code/repl/components/Spinner/useShimmerAnimation.js'
import {
  generatePermissionExplanation,
  isPermissionExplainerEnabled,
  riskLevelColor,
  riskLevelLabel,
  type PermissionExplanation as ExplanationData,
} from '../permissionExplainer.js'

const LOADING_TEXT = 'Loading explanation\u2026'

/** Inputs the explainer needs to describe a pending tool call. */
export type PermissionExplainerInput = {
  toolName: string
  toolInput: unknown
  toolDescription?: string
  messages?: Parameters<typeof generatePermissionExplanation>[0]['messages']
}

export type PermissionExplainerState = {
  /** Whether the explanation block should be visible. */
  visible: boolean
  /** Whether the explainer feature is enabled (gates the hint + keybinding). */
  enabled: boolean
  /** The display string for the toggle shortcut (e.g. "ctrl+e"). */
  chord: string
  /** The in-flight / resolved explanation promise, or null before first toggle. */
  promise: Promise<ExplanationData | null> | null
}

/**
 * ant Wy6 — owns the keybinding + LLM-call lifecycle. Call from a permission
 * request component; render the returned state via <PermissionExplanation />.
 */
export function usePermissionExplainer(
  input: PermissionExplainerInput,
): PermissionExplainerState {
  const enabled = isPermissionExplainerEnabled()
  const chord = useShortcutDisplay(
    'confirm:toggleExplanation',
    'Confirmation',
    'ctrl+e',
  )
  const [visible, setVisible] = useState(false)
  const [promise, setPromise] = useState<Promise<ExplanationData | null> | null>(
    null,
  )
  const abortRef = useRef<AbortController | null>(null)

  const handleToggle = useCallback(() => {
    // Only start a request when first becoming visible.
    if (!visible) {
      logEvent('tengu_permission_explainer_shortcut_used', {})
      if (!promise) {
        const controller = new AbortController()
        abortRef.current = controller
        setPromise(
          generatePermissionExplanation({
            toolName: input.toolName,
            toolInput: input.toolInput,
            toolDescription: input.toolDescription,
            messages: input.messages ?? [],
            signal: controller.signal,
          }).catch(() => null),
        )
      }
    }
    setVisible(prev => !prev)
  }, [visible, promise, input])

  useKeybinding('confirm:toggleExplanation', handleToggle, {
    context: 'Confirmation',
    isActive: enabled,
  })

  // Abort any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), [])

  return { visible, enabled, chord, promise }
}

/**
 * ant APO — renders the resolved explanation. Suspends on the promise via
 * React.use until it settles.
 */
function PermissionExplanationContent({
  promise,
}: {
  promise: Promise<ExplanationData | null>
}): React.ReactNode {
  const data = use(promise)

  if (!data) {
    return (
      <Box marginTop={1}>
        <Text dimColor>Explanation unavailable</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>{data.explanation}</Text>
      <Box marginTop={1}>
        <Text>{data.reasoning}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text color={riskLevelColor(data.riskLevel)}>
            {riskLevelLabel(data.riskLevel)}:
          </Text>
          <Text> {data.risk}</Text>
        </Text>
      </Box>
    </Box>
  )
}

/** ant KPO — the loading shimmer shown while the explanation generates. */
function LoadingExplanation(): React.ReactNode {
  const [ref, glimmerIndex] = useShimmerAnimation(
    'responding',
    LOADING_TEXT,
    false,
  )
  return (
    <Box ref={ref}>
      <Text>
        {[...LOADING_TEXT].map((char, i) => (
          <ShimmerChar
            key={i}
            char={char}
            index={i}
            glimmerIndex={glimmerIndex}
            messageColor="inactive"
            shimmerColor="text"
          />
        ))}
      </Text>
    </Box>
  )
}

/**
 * ant Zy6 — the Suspense container. Renders nothing until the user toggles the
 * explainer visible (and a request has been kicked off).
 */
export function PermissionExplanation({
  visible,
  promise,
}: {
  visible: boolean
  promise: Promise<ExplanationData | null> | null
}): React.ReactNode {
  if (!visible || !promise) return null
  return (
    <Suspense
      fallback={
        <Box marginTop={1}>
          <LoadingExplanation />
        </Box>
      }
    >
      <PermissionExplanationContent promise={promise} />
    </Suspense>
  )
}
