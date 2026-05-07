import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { FrameAnimation } from '../FrameAnimation.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'multi-provider',
  title: 'Talk to any model',
  tagline: 'Anthropic/OpenAI/Gemini/Grok',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        ccb talks to four model families through one agent loop. The same
        tools, MCP servers, agents, and hooks all work — only the model
        behind the curtain changes.
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          <Text color="success">Anthropic</Text> — default. Run{' '}
          <Text color="suggestion">ccb auth</Text> for OAuth or set{' '}
          <Text color="suggestion">ANTHROPIC_API_KEY</Text>.
        </Text>
        <Text>
          <Text color="success">OpenAI-compatible</Text> —{' '}
          <Text color="suggestion">CLAUDE_CODE_USE_OPENAI=1</Text> with{' '}
          <Text color="suggestion">OPENAI_API_KEY</Text> /{' '}
          <Text color="suggestion">OPENAI_BASE_URL</Text>. Works with Ollama,
          DeepSeek, vLLM.
        </Text>
        <Text>
          <Text color="success">Gemini</Text> —{' '}
          <Text color="suggestion">CLAUDE_CODE_USE_GEMINI=1</Text> +{' '}
          <Text color="suggestion">GEMINI_API_KEY</Text>.
        </Text>
        <Text>
          <Text color="success">Grok</Text> — same env-var pattern.
        </Text>
      </Box>
      <FrameAnimation
        frames={[
          '> [suggestion:/model]\n#◯ claude-opus-4-7\n#● gpt-5o\n#◯ gemini-2.5-pro',
          '> reload that on Gemini\n#◐ switching connection…',
          '#[gemini:thinking…]\nSame answer, different model.',
        ]}
      />
      <Text dimColor>
        Switch mid-session with <Text color="suggestion">/model</Text>, or
        per-process with the env vars above.
      </Text>
    </Box>
  ),
}
