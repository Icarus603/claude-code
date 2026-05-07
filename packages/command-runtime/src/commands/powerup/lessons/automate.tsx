import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { FrameAnimation } from '../FrameAnimation.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'automate',
  title: 'Automate your workflow',
  tagline: 'skills, hooks',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        Save a prompt to{' '}
        <Text color="suggestion">.claude/skills/deploy/SKILL.md</Text> and it
        becomes <Text color="suggestion">/deploy</Text> — type it, ccb runs
        it. Run <Text color="suggestion">/skills</Text> to see what you have.
      </Text>
      <FrameAnimation
        frames={[
          '> [suggestion:/deploy] staging\n#◐ skill: deploy',
          '[success:✓] built\n[success:✓] tests pass\n#◐ pushing to staging…',
          '[success:✓] deployed\n#[suggestion:staging.app.com]\n#PostToolUse hook ran prettier',
        ]}
      />
      <Text>
        Hooks run your own scripts on events: before a tool call, after a
        response, on session start. Use them to enforce rules, log activity,
        or inject context. Run <Text color="suggestion">/hooks</Text> to see
        what fires when.
      </Text>
      <Text dimColor>
        Run <Text color="suggestion">/install-github-app</Text> to let ccb
        review PRs when tagged.
      </Text>
    </Box>
  ),
}
