import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { FrameAnimation } from '../FrameAnimation.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'at-mentions',
  title: 'Talk to your codebase',
  tagline: '@ files, line refs',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        Type <Text underline>@</Text> anywhere in your prompt to fuzzy-find and
        attach a file. Claude reads it before answering — no more pasting code.
      </Text>
      <FrameAnimation
        frames={[
          '> what does [suggestion:@]\n#type a file name…',
          '> what does [suggestion:@src/auth.ts]\n  [suggestion:❯ src/auth.ts]\n#   src/auth.test.ts',
          '> what does [suggestion:@src/auth.ts] do?\n#◐ Reading src/auth.ts…',
          '> what does [suggestion:@src/auth.ts] do?\nExports validateToken() which\nchecks JWT expiry and signature.',
        ]}
      />
      <Text>
        Reference specific lines with{' '}
        <Text color="suggestion">src/app.ts:42</Text> and Claude jumps straight
        there. Works in both directions: Claude cites files the same way, so
        you can click to open them in your editor.
      </Text>
      <Text dimColor>
        Also try: <Text color="suggestion">@folder/</Text> to attach a whole
        directory tree.
      </Text>
    </Box>
  ),
}
