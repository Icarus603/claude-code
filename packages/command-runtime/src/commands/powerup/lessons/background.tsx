import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { FrameAnimation } from '../FrameAnimation.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'background',
  title: 'Run in the background',
  tagline: '--bg, ccb ps/logs/attach',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        Long builds and test suites should not block you. ccb gives you two
        layers:
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          <Text color="success">in-session</Text> — append{' '}
          <Text underline>&amp;</Text> to any bash command. ccb runs it in
          the background, you keep prompting, output streams when ready.
        </Text>
        <Text>
          <Text color="success">detached</Text> —{' '}
          <Text color="suggestion">ccb --bg "task here"</Text> spawns the
          whole agent in the background, surviving your terminal closing.
        </Text>
      </Box>
      <FrameAnimation
        frames={[
          '> run the test suite [claude:&]\n#task started in background',
          '> now fix the lint in app.ts\n#◐ Editing app.ts…\n#[warning:◐] bun test · 12s',
          '#$ ccb ps\n#  abc123  bun test         · running 4m12s\n#  def456  benchmark        · running 38s',
          '#$ ccb attach abc123\n#← jumping into that session\n[success:✓] 284 pass',
        ]}
      />
      <Text>
        Manage detached sessions with{' '}
        <Text color="suggestion">ccb ps</Text>,{' '}
        <Text color="suggestion">ccb logs &lt;id&gt;</Text>,{' '}
        <Text color="suggestion">ccb attach &lt;id&gt;</Text>, and{' '}
        <Text color="suggestion">ccb kill &lt;id&gt;</Text>.
      </Text>
      <Text dimColor>
        Subagents and forks land in the same task panel — one queue, one
        place to watch.
      </Text>
    </Box>
  ),
}
