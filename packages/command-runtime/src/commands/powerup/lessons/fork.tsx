import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { FrameAnimation } from '../FrameAnimation.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'fork',
  title: 'Fork your context',
  tagline: '/fork, parallel branches',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        Want a parallel branch of <Text bold>this</Text> conversation? Type{' '}
        <Text color="suggestion">/fork &lt;directive&gt;</Text>. ccb spawns
        a worker that inherits your full context — system prompt + every
        message — and runs in the background. You keep going; the fork
        reports back when done.
      </Text>
      <FrameAnimation
        frames={[
          '> /fork explore the new auth design\n#🍴 forked explore-the (ab12)',
          '> meanwhile, fix the lint\n#◐ Editing app.ts…\n#[warning:◐] fork explore-the · 18s',
          '#[success:✓] fork explore-the\n2 design alternatives + tradeoffs.\n  [suggestion:see fork report]',
        ]}
      />
      <Text>
        Forks differ from subagents: forks <Text bold>inherit</Text> your
        context (good for "explore alternative X" branches), while subagents
        run with a fresh context (good for "noisy tool work I do not want
        in my history"). When ccb's <Text color="suggestion">Agent</Text>{' '}
        tool is called without{' '}
        <Text color="suggestion">subagent_type</Text>, it also forks — same
        machinery.
      </Text>
      <Text dimColor>
        Watch all forks (and subagents, and tasks) in one panel — press{' '}
        <Text underline>↓</Text> to manage.
      </Text>
    </Box>
  ),
}
