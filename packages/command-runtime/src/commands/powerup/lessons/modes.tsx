import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { LiveModeCycler } from '../LiveModeCycler.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'modes',
  title: 'Steer with modes',
  tagline: 'shift+tab, plan, auto',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        Press <Text underline>shift+tab</Text> to cycle permission modes. Each
        mode changes how much Claude asks before acting:
      </Text>
      <LiveModeCycler />
      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          <Text color="success">default</Text> — ask before every edit
        </Text>
        <Text>
          <Text color="autoAccept">accept edits</Text> — edit freely, ask for commands
        </Text>
        <Text>
          <Text color="planMode">plan</Text> — research and propose, never touch files
        </Text>
        <Text>
          <Text color="warning">auto</Text> — Claude decides what is safe
        </Text>
      </Box>
      <Text dimColor>
        Use <Text color="planMode">plan</Text> for big refactors you want to
        review first. Use <Text color="warning">auto</Text> for long unattended
        tasks. Run <Text color="suggestion">/permissions</Text> to pre-allow
        specific commands so Claude stops asking about them.
      </Text>
    </Box>
  ),
}
