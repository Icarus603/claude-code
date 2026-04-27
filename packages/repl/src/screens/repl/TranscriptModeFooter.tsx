import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import figures from 'figures'
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js'

/**
 * Small component to display transcript mode footer with dynamic keybinding.
 * Must be rendered inside KeybindingSetup to access keybinding context.
 *
 * V7 §3.3 — extracted from REPLView.tsx (iter 18). This was section-level
 * UI chrome that didn't need to live inside the REPL god component.
 */
export function TranscriptModeFooter({
  showAllInTranscript,
  virtualScroll,
  searchBadge,
  suppressShowAll = false,
  status,
}: {
  showAllInTranscript: boolean
  virtualScroll: boolean
  /** Minimap while navigating a closed-bar search. Shows n/N hints +
   *  right-aligned count instead of scroll hints. */
  searchBadge?: { current: number; count: number }
  /** Hide the ctrl+e hint. The [ dump path shares this footer with
   *  env-opted dump (CLAUDE_CODE_NO_FLICKER=0 / DISABLE_VIRTUAL_SCROLL=1),
   *  but ctrl+e only works in the env case — useGlobalKeybindings.tsx
   *  gates on !virtualScrollActive which is env-derived, doesn't know
   *  [ happened. */
  suppressShowAll?: boolean
  /** Transient status (v-for-editor progress). Notifications render inside
   *  PromptInput which isn't mounted in transcript — addNotification queues
   *  but nothing draws it. */
  status?: string
}): React.ReactNode {
  const toggleShortcut = useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o')
  const showAllShortcut = useShortcutDisplay('transcript:toggleShowAll', 'Transcript', 'ctrl+e')
  return (
    <Box
      noSelect
      alignItems="center"
      alignSelf="center"
      borderTopDimColor
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      marginTop={1}
      paddingLeft={2}
      width="100%"
    >
      <Text dimColor>
        Showing detailed transcript · {toggleShortcut} to toggle
        {searchBadge
          ? ' · n/N to navigate'
          : virtualScroll
            ? ` · ${figures.arrowUp}${figures.arrowDown} scroll · home/end top/bottom`
            : suppressShowAll
              ? ''
              : ` · ${showAllShortcut} to ${showAllInTranscript ? 'collapse' : 'show all'}`}
      </Text>
      {status ? (
        // v-for-editor render progress — transient, preempts the search
        // badge since the user just pressed v and wants to see what's
        // happening. Clears after 4s.
        <>
          <Box flexGrow={1} />
          <Text>{status} </Text>
        </>
      ) : searchBadge ? (
        // Engine-counted — close enough for a rough location hint. May
        // drift from render-count for ghost/phantom messages.
        <>
          <Box flexGrow={1} />
          <Text dimColor>
            {searchBadge.current}/{searchBadge.count}
            {'  '}
          </Text>
        </>
      ) : null}
    </Box>
  )
}
