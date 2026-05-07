import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { FrameAnimation } from '../FrameAnimation.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'model-dial',
  title: 'Dial the model',
  tagline: '/model, /effort, /fast',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        Run <Text color="suggestion">/model</Text> to switch models. Opus for
        hard problems, Sonnet for most work, Haiku for quick questions. Each
        trades speed for depth.
      </Text>
      <FrameAnimation
        frames={[
          '> [suggestion:/effort] high\n#effort set to [claude:high]',
          '> why is the list page slow?\n#[claude:◐ thinking deeply…]',
          'Three hypotheses, ranked:\n 1. N+1 query in loader\n 2. missing index on users',
        ]}
      />
      <Text>
        <Text color="suggestion">/effort</Text> controls how long ccb thinks
        before answering. <Text underline>high</Text> for tricky bugs,{' '}
        <Text underline>low</Text> when you just need a quick edit.
      </Text>
      <Text dimColor>
        Also: <Text color="suggestion">/fast</Text> toggles fast mode (Opus
        4.6, faster output, same model family).
      </Text>
    </Box>
  ),
}
