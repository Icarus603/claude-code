import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { FrameAnimation } from '../FrameAnimation.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'mcp',
  title: 'Extend with tools',
  tagline: 'MCP, /mcp',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        MCP servers give ccb new tools: read your Slack, query your database,
        control your browser. Run <Text color="suggestion">/mcp</Text> to
        browse and connect servers.
      </Text>
      <FrameAnimation
        frames={[
          '> [suggestion:/mcp]\nConnected servers:\n  [success:✓] slack    [success:✓] github',
          '> anything urgent in #eng?\n#◐ [suggestion:slack] · reading channel…',
          'Boris posted about the merge\nfreeze. Also 3 PRs await\nyour review on github.',
        ]}
      />
      <Text>
        Once connected, tools appear automatically — ask ccb to "check my
        calendar" or "search our Notion" and it just works.
      </Text>
      <Text dimColor>
        From your shell:{' '}
        <Text color="suggestion">ccb mcp add my-server -- npx some-mcp-pkg</Text>{' '}
        to wire one up without leaving the terminal.
      </Text>
    </Box>
  ),
}
