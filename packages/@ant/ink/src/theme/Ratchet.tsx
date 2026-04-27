import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { useTerminalViewport } from '../hooks/use-terminal-viewport.js'
import { default as Box } from './ThemedBox.js'
import type { DOMElement } from '../core/dom.js'
import { default as measureElement } from '../core/measure-element.js'

type Props = {
  children: React.ReactNode
  lock?: 'always' | 'offscreen'
}

export function Ratchet({ children, lock = 'always' }: Props): React.ReactNode {
  const [viewportRef, { isVisible }] = useTerminalViewport()
  const { rows } = useTerminalSize()
  const innerRef = useRef<DOMElement | null>(null)
  const maxHeight = useRef(0)
  const [minHeight, setMinHeight] = useState(0)

  const outerRef = useCallback(
    (el: DOMElement | null) => {
      viewportRef(el)
    },
    [viewportRef],
  )

  const engaged = lock === 'always' || !isVisible

  useLayoutEffect(() => {
    if (!innerRef.current) {
      return
    }
    const { height } = measureElement(innerRef.current)
    if (height > maxHeight.current) {
      maxHeight.current = Math.min(height, rows)
      setMinHeight(maxHeight.current)
    }
  })

  return (
    <Box minHeight={engaged ? minHeight : undefined} ref={outerRef}>
      <Box ref={innerRef} flexDirection="column">
        {children}
      </Box>
    </Box>
  )
}
