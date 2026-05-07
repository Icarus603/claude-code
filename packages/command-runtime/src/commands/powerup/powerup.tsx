import * as React from 'react'
import { useState } from 'react'
import { Box, Text } from '@anthropic/ink'
import { Select } from '@claude-code/repl/components/CustomSelect/index.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import { ALL_LESSONS } from './lessons/index.js'
import type { Lesson } from './lessons/types.js'
import {
  getUnlocked,
  isAllUnlocked,
  markUnlocked,
  totalLessons,
} from './state.js'

/**
 * /powerup entry. Renders the lesson list; selecting a lesson navigates to
 * a detail panel; confirming "Yes — mark done" marks the lesson and
 * returns to the list. When all lessons unlock for the first time, a
 * celebration panel takes over until dismissed.
 *
 * Mirrors ant 4304.js _qK + eK3 + the celebration component (a8K). State
 * is local except for the persisted unlocked-set, which goes through
 * state.ts to globalConfig.
 *
 * The screen owns three modes (list / detail / celebration) and passes
 * the parent's `onExit` through; the slash-command runtime closes the
 * screen when `onExit` is invoked.
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
 * and is unit-testable without mocking config. Exported so the marker
 * logic (✓ vs ○, success colour on done lessons) has direct unit
 * coverage without mounting the full screen against bun:test (no Ink
 * renderer is available).
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
  const [mode, setMode] = useState<Mode>(() =>
    isAllUnlocked() ? { kind: 'celebration' } : { kind: 'list' },
  )

  function openLesson(lesson: Lesson) {
    logEvent('tengu_powerup_lesson_opened', {
      lesson_id:
        lesson.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      was_already_unlocked: unlocked.has(lesson.id),
      unlocked_count: unlocked.size,
    })
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
      onSelect={openLesson}
      onCancel={() => onExit('Power-ups closed')}
    />
  )
}

function PowerupList({
  unlocked,
  onSelect,
  onCancel,
}: {
  unlocked: Set<string>
  onSelect: (l: Lesson) => void
  onCancel: () => void
}): React.ReactNode {
  const total = totalLessons()
  const options = buildLessonOptions(unlocked)

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="claude">
          Power-ups
        </Text>
        <Text dimColor>{` ${unlocked.size}/${total} unlocked `}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor wrap="wrap">
          Each power-up teaches one thing ccb can do that most people miss.
          Open one, read it, try it, mark it done.
        </Text>
      </Box>
      <Select<string>
        options={options}
        hideIndexes
        visibleOptionCount={ALL_LESSONS.length}
        onChange={(id: string) => {
          const found = ALL_LESSONS.find(l => l.id === id)
          if (found) onSelect(found)
        }}
        onCancel={onCancel}
      />
    </Box>
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
    <Box flexDirection="column" gap={1}>
      <Box>
        <Text>{isUnlocked ? '✓ ' : '○ '}</Text>
        <Text bold color="claude">
          {lesson.title}
        </Text>
      </Box>
      {lesson.body}
      <Box marginTop={1} flexDirection="column">
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
      </Box>
    </Box>
  )
}

function CelebrationScreen({
  onExit,
}: {
  onExit: () => void
}): React.ReactNode {
  const options = [{ label: 'Close', value: 'close' }]
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="claude">
        ✨ All powered up — now go build ✨
      </Text>
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
