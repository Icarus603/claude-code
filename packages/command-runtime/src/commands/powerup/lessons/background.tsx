import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { FrameAnimation } from '../FrameAnimation.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'background',
  title: 'Run in the background',
  tagline: '/bg, --bg, ccb ps/attach',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        Long builds and test suites should not block you. ccb gives you
        three ways to escape the foreground:
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          <Text color="success">in-session</Text> — append{' '}
          <Text underline>&amp;</Text> to any bash command. ccb runs it in
          the background, you keep prompting, output streams when ready.
        </Text>
        <Text>
          <Text color="success">detach this session</Text> — type{' '}
          <Text color="suggestion">/background</Text> (alias{' '}
          <Text color="suggestion">/bg</Text>) and your current REPL keeps
          running in the background; the terminal returns to your shell.
        </Text>
        <Text>
          <Text color="success">launch detached</Text> —{' '}
          <Text color="suggestion">ccb --bg "task here"</Text> spawns the
          whole agent in the background from the start, surviving your
          terminal closing.
        </Text>
      </Box>
      <FrameAnimation
        frames={[
          '> run the test suite [claude:&]\n#task started in background',
          '> [suggestion:/bg] keep going on the migration\n#◐ session detached, terminal freed',
          '#$ ccb ps\n#  abc123  bun test     · running 4m\n#  def456  migration    · running 38s',
          '#$ ccb attach abc123\n#← bidirectional, like you never left',
        ]}
      />
      <Text>
        Manage detached sessions from your shell:
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          <Text color="suggestion">ccb ps</Text> — list all background
          sessions.
        </Text>
        <Text>
          <Text color="suggestion">ccb logs &lt;short&gt;</Text> — print or
          follow output (<Text color="suggestion">--follow</Text>,{' '}
          <Text color="suggestion">--tail N</Text>).
        </Text>
        <Text>
          <Text color="suggestion">ccb attach &lt;short&gt;</Text> — jump
          back in bidirectionally, exactly where you left off.
        </Text>
        <Text>
          <Text color="suggestion">ccb stop &lt;short&gt;</Text> — graceful
          shutdown (SIGTERM; <Text color="suggestion">--force</Text> for
          SIGKILL).{' '}
          <Text color="suggestion">ccb kill</Text> is{' '}
          <Text color="suggestion">stop --force</Text>.
        </Text>
        <Text>
          <Text color="suggestion">ccb rm &lt;short&gt;</Text> — remove a
          stopped session's job directory.
        </Text>
        <Text>
          <Text color="suggestion">ccb respawn &lt;short&gt;|--all</Text> —
          restart a backgrounded session with its original directive.
        </Text>
      </Box>
      <Text dimColor>
        Subagents and forks land in the same task panel — one queue, one
        place to watch. Press <Text underline>↓</Text> in the REPL to open
        it.
      </Text>
    </Box>
  ),
}
