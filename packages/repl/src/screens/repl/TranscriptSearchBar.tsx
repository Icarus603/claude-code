import * as React from 'react'
import { useEffect, type RefObject } from 'react'
import { Box, Text } from '@anthropic/ink'
import { useSearchInput } from '@anthropic/ink/search'
import type { JumpHandle } from '@claude-code/repl/components/VirtualMessageList.js'

/** less-style / bar. 1-row, same border-top styling as TranscriptModeFooter
 *  so swapping them in the bottom slot doesn't shift ScrollBox height.
 *  useSearchInput handles readline editing; we report query changes and
 *  render the counter. Incremental — re-search + highlight per keystroke.
 *
 *  V7 §3.3 — extracted from REPLView.tsx (iter 18). */
export function TranscriptSearchBar({
  jumpRef,
  count,
  current,
  onClose,
  onCancel,
  setHighlight,
  initialQuery,
}: {
  jumpRef: RefObject<JumpHandle | null>
  count: number
  current: number
  /** Enter — commit. Query persists for n/N. */
  onClose: (lastQuery: string) => void
  /** Esc/ctrl+c/ctrl+g — undo to pre-/ state. */
  onCancel: () => void
  setHighlight: (query: string) => void
  // Seed with the previous query (less: / shows last pattern). Mount-fire
  // of the effect re-scans with the same query — idempotent (same matches,
  // nearest-ptr, same highlights). User can edit or clear.
  initialQuery: string
}): React.ReactNode {
  const { query, cursorOffset } = useSearchInput({
    isActive: true,
    initialQuery,
    onExit: () => onClose(query),
    onCancel,
  })
  // Index warm-up runs before the query effect so it measures the real
  // cost — otherwise setSearchQuery fills the cache first and warm
  // reports ~0ms while the user felt the actual lag.
  const [indexStatus, setIndexStatus] = React.useState<'building' | { ms: number } | null>('building')
  React.useEffect(() => {
    let alive = true
    const warm = jumpRef.current?.warmSearchIndex
    if (!warm) {
      setIndexStatus(null)
      return
    }
    setIndexStatus('building')
    warm().then(ms => {
      if (!alive) return
      if (ms < 20) {
        setIndexStatus(null)
      } else {
        setIndexStatus({ ms })
        setTimeout(() => alive && setIndexStatus(null), 2000)
      }
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const warmDone = indexStatus !== 'building'
  useEffect(() => {
    if (!warmDone) return
    jumpRef.current?.setSearchQuery(query)
    setHighlight(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, warmDone])
  const off = cursorOffset
  const cursorChar = off < query.length ? query[off] : ' '
  return (
    <Box
      borderTopDimColor
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      marginTop={1}
      paddingLeft={2}
      width="100%"
      noSelect
    >
      <Text>/</Text>
      <Text>{query.slice(0, off)}</Text>
      <Text inverse>{cursorChar}</Text>
      {off < query.length && <Text>{query.slice(off + 1)}</Text>}
      <Box flexGrow={1} />
      {indexStatus === 'building' ? (
        <Text dimColor>indexing… </Text>
      ) : indexStatus ? (
        <Text dimColor>indexed in {indexStatus.ms}ms </Text>
      ) : count === 0 && query ? (
        <Text color="error">no matches </Text>
      ) : count > 0 ? (
        <Text dimColor>
          {current}/{count}
          {'  '}
        </Text>
      ) : null}
    </Box>
  )
}
