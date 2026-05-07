import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { FrameAnimation } from '../FrameAnimation.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'undo',
  title: 'Undo anything',
  tagline: '/rewind, Esc-Esc',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        ccb checkpoints your files before every edit. Press{' '}
        <Text underline>Esc Esc</Text> (double-tap) to open{' '}
        <Text color="suggestion">/rewind</Text> and roll back to any prior
        state — code, conversation, or both.
      </Text>
      <FrameAnimation
        frames={[
          '[success:✓] Updated regex in parser.ts\n#[error:8 tests failing]',
          '#press Esc Esc\nRewind to:\n  [suggestion:❯ before parser.ts edit]',
          '#[success:✓] parser.ts restored\n> try a simpler approach\n#◐ thinking…',
        ]}
      />
      <Text>
        Went down the wrong path? Rewind to before the detour and try a
        different prompt. Your git history stays clean.
      </Text>
      <Text dimColor>
        Also: <Text color="suggestion">/clear</Text> wipes conversation but
        keeps files.
      </Text>
    </Box>
  ),
}
