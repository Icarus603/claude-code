import * as React from 'react'
import { useState } from 'react'
import { Box, Byline, KeyboardShortcutHint, Text } from '@anthropic/ink'
import { Select } from '@claude-code/repl/components/CustomSelect/index.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import { ProgressBar } from '@anthropic/ink'
import { CelebrationShimmer } from './CelebrationShimmer.js'
import { ALL_LESSONS } from './lessons/index.js'
import type { Lesson } from './lessons/types.js'
import { getUnlocked, markUnlocked, totalLessons } from './state.js'

/**
 * /powerup entry. Renders the lesson list; selecting a lesson navigates to
 * a detail panel; confirming "Yes — mark done" marks the lesson and
 * returns to the list. When all lessons unlock for the first time, a
 * celebration panel takes over until dismissed.
 *
 * Mirrors ant 4304.js _qK + eK3 + a8K. State is local except for the
 * persisted unlocked-set, which goes through state.ts to globalConfig.
 *
 * Visual structure (matches ant 2.1.131's `G1` + content):
 *   <Box paddingX={2} paddingTop={1}
 *        borderTop borderColor="claude"
 *        borderLeft={false} borderRight={false} borderBottom={false}>
 *     header (title + counter + progress)
 *     description / lesson body
 *     <Select>               (the picker / detail confirm)
 *     keyboard hints byline  (↑↓ select · Enter open · Esc close)
 *   </Box>
 *
 * The top-rule uses Ink's real border-rendering (selective `borderTop`
 * with the other three sides off) instead of a `'─'.repeat(columns)`
 * string. The string approach wraps when its length exceeds the
 * Box's content width minus padding, leaving the "long-line +
 * short-line" double-rule artefact we hit in the first port.
 *
 * Esc-from-detail must return the user to the lesson they came from in
 * the list, NOT reset focus to row 0. The `lastFocusedId` state on
 * `PowerupScreen` records the last lesson opened so `<Select
 * defaultFocusValue={...}>` reseeds the picker on remount.
 */

type Mode =
  | { kind: 'list' }
  | { kind: 'detail'; lesson: Lesson }
  | { kind: 'celebration' }

type LessonOption = {
  label: React.ReactNode
  value: string
  description?: string
}

/**
 * Build the option list shown in the lesson picker. Pure: callers pass
 * the current unlocked set so this function does not read global state
 * and is unit-testable without mocking config.
 */
export function buildLessonOptions(unlocked: Set<string>): LessonOption[] {
  return ALL_LESSONS.map(l => {
    const done = unlocked.has(l.id)
    const marker = done ? '✓' : '○'
    const text = `${marker} ${l.title}`
    return {
      label: done ? <Text color="success">{text}</Text> : text,
      value: l.id,
      description: l.tagline,
    }
  })
}

type PowerupScreenProps = {
  onExit: (msg?: string) => void
}

export function PowerupScreen({ onExit }: PowerupScreenProps): React.ReactNode {
  const [unlocked, setUnlocked] = useState<Set<string>>(() => getUnlocked())
  // Always start at list — even on re-entry after 100% unlock. ant 4304.js
  // useState defaults `showCelebration` to false (line 471) and only fires
  // it on the transition where the LAST lesson is marked done in the
  // current session. Subsequent /powerup invocations land on list, which
  // displays the "All powered up" shimmer + "Now go build something."
  // copy via the allDone path in PowerupList.
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  // Last lesson the user opened. Lets Esc-back from detail return focus
  // to that row instead of resetting to row 0 on every remount.
  const [lastFocusedId, setLastFocusedId] = useState<string | undefined>(
    undefined,
  )

  function openLesson(lesson: Lesson) {
    logEvent('tengu_powerup_lesson_opened', {
      lesson_id:
        lesson.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      was_already_unlocked: unlocked.has(lesson.id),
      unlocked_count: unlocked.size,
    })
    setLastFocusedId(lesson.id)
    setMode({ kind: 'detail', lesson })
  }

  function unlock(id: string) {
    if (unlocked.has(id)) {
      setMode({ kind: 'list' })
      return
    }
    const next = new Set(unlocked)
    next.add(id)
    setUnlocked(next)
    markUnlocked(id)
    logEvent('tengu_powerup_lesson_completed', {
      lesson_id: id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      unlocked_count: next.size,
      all_unlocked: next.size === ALL_LESSONS.length,
    })
    if (next.size === ALL_LESSONS.length) {
      setMode({ kind: 'celebration' })
    } else {
      setMode({ kind: 'list' })
    }
  }

  if (mode.kind === 'celebration') {
    return <CelebrationScreen onExit={() => onExit('Power-ups closed')} />
  }

  if (mode.kind === 'detail') {
    return (
      <LessonDetail
        lesson={mode.lesson}
        isUnlocked={unlocked.has(mode.lesson.id)}
        onMarkDone={() => unlock(mode.lesson.id)}
        onBack={() => setMode({ kind: 'list' })}
      />
    )
  }

  return (
    <PowerupList
      unlocked={unlocked}
      defaultFocusId={lastFocusedId}
      onSelect={openLesson}
      onCancel={() => onExit('Power-ups closed')}
    />
  )
}

/**
 * Content wrapper. Mirrors the post-rule content portion of ant 2453.js
 * `G1`: `paddingX: 2` indent only.
 *
 * Ant's `G1` ALSO renders a claude-coloured horizontal rule on top.
 * ccb's REPL already inserts a session divider above slash-command
 * output (the long claude rule visible at the top of every screen),
 * so adding our own would render TWO rules — an artefact. The REPL's
 * own divider is ant's G1 rule for our purposes; we just provide the
 * content-side indent here. No paddingTop — ant's G1 has it, but the
 * REPL's session divider already supplies the visual breathing room.
 */
function PowerupPanel({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  return (
    <Box flexDirection="column" paddingX={2}>
      {children}
    </Box>
  )
}

function PowerupList({
  unlocked,
  defaultFocusId,
  onSelect,
  onCancel,
}: {
  unlocked: Set<string>
  defaultFocusId: string | undefined
  onSelect: (l: Lesson) => void
  onCancel: () => void
}): React.ReactNode {
  const total = totalLessons()
  const options = buildLessonOptions(unlocked)
  const allDone = unlocked.size === total
  const ratio = total === 0 ? 0 : unlocked.size / total

  return (
    <PowerupPanel>
      {/* Header row: heading + counter + progress bar, all on one line.
          Mirrors ant 4304.js:582 — `<B marginBottom=1>{Z}{k}{N}</B>`.
          When `allDone` the heading swaps to the shimmering "All powered
          up" via CelebrationShimmer (ant a8K). */}
      <Box marginBottom={1}>
        {allDone ? (
          <CelebrationShimmer text="All powered up" />
        ) : (
          <Text bold color="claude">
            Power-ups
          </Text>
        )}
        <Text dimColor>{` ${unlocked.size}/${total} unlocked `}</Text>
        <ProgressBar
          ratio={ratio}
          width={16}
          fillColor="rate_limit_fill"
          emptyColor="rate_limit_empty"
        />
      </Box>
      <Box marginBottom={1}>
        <Text dimColor wrap="wrap">
          {allDone
            ? 'Now go build something.'
            : 'Each power-up teaches one thing ccb can do that most people miss. Open one, read it, try it, mark it done.'}
        </Text>
      </Box>
      <Select<string>
        options={options}
        hideIndexes
        visibleOptionCount={ALL_LESSONS.length}
        defaultFocusValue={defaultFocusId}
        onChange={(id: string) => {
          const found = ALL_LESSONS.find(l => l.id === id)
          if (found) onSelect(found)
        }}
        onCancel={onCancel}
      />
      <Box marginTop={1}>
        <Text dimColor italic>
          <Byline>
            <KeyboardShortcutHint shortcut="↑↓" action="select" />
            <KeyboardShortcutHint shortcut="Enter" action="open" />
            <KeyboardShortcutHint shortcut="Esc" action="close" />
          </Byline>
        </Text>
      </Box>
    </PowerupPanel>
  )
}

function LessonDetail({
  lesson,
  isUnlocked,
  onMarkDone,
  onBack,
}: {
  lesson: Lesson
  isUnlocked: boolean
  onMarkDone: () => void
  onBack: () => void
}): React.ReactNode {
  const options = [
    { label: 'Yes — mark done', value: 'yes' },
    { label: 'No — back to list', value: 'no' },
  ]
  return (
    <PowerupPanel>
      <Box flexDirection="column" gap={1}>
        <Box>
          <Text>{isUnlocked ? '✓ ' : '○ '}</Text>
          <Text bold color="claude">
            {lesson.title}
          </Text>
        </Box>
        {lesson.body}
        <Box flexDirection="column">
          <Text dimColor>Mark as done?</Text>
          <Select<string>
            options={options}
            hideIndexes
            onChange={(v: string) => {
              if (v === 'yes') onMarkDone()
              else onBack()
            }}
            onCancel={onBack}
          />
          <Box marginTop={1}>
            <Text dimColor italic>
              <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="mark done" />
                <KeyboardShortcutHint shortcut="Esc" action="back" />
              </Byline>
            </Text>
          </Box>
        </Box>
      </Box>
    </PowerupPanel>
  )
}

function CelebrationScreen({
  onExit,
}: {
  onExit: () => void
}): React.ReactNode {
  const options = [{ label: 'Close', value: 'close' }]
  return (
    <PowerupPanel>
      <Box flexDirection="column" gap={1}>
        <CelebrationShimmer text="✨ All powered up — now go build ✨" />
        <Text dimColor>
          You've unlocked every power-up. Run /powerup again any time to
          re-open a lesson; the banner is gone for good.
        </Text>
        <Select<string>
          options={options}
          hideIndexes
          onChange={onExit}
          onCancel={onExit}
        />
      </Box>
    </PowerupPanel>
  )
}

/* ===========================================================
 *  Slash command call() entry
 * =========================================================== */

export async function call(
  onDone: LocalJSXCommandOnDone,
): Promise<React.ReactNode> {
  return <PowerupScreen onExit={(msg?: string) => onDone(msg)} />
}
