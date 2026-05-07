import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { FrameAnimation } from '../FrameAnimation.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'memory',
  title: 'Teach ccb your rules',
  tagline: 'CLAUDE.md, /memory',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        Drop a <Text color="suggestion">CLAUDE.md</Text> file in your repo and
        ccb reads it at the start of every session. Put your conventions
        there: test commands, style rules, do-not-touch directories.
      </Text>
      <FrameAnimation
        frames={[
          '#─ CLAUDE.md ─\n#Run tests with: [suggestion:bun test]\n#Never edit src/legacy/',
          '> add tests for the cache\n#◐ reading CLAUDE.md…',
          '> add tests for the cache\nWriting cache.test.ts,\nrunning [suggestion:bun test] to verify.',
        ]}
      />
      <Text>
        Run <Text color="suggestion">/init</Text> to generate a starter
        CLAUDE.md from your codebase. Run{' '}
        <Text color="suggestion">/memory</Text> to edit it inline.
      </Text>
      <Text dimColor>
        Works at three levels: repo, your home directory (all projects), and
        per-directory overrides.
      </Text>
    </Box>
  ),
}
