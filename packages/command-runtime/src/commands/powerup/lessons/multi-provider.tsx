import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { FrameAnimation } from '../FrameAnimation.js'
import type { Lesson } from './types.js'

export const lesson: Lesson = {
  id: 'multi-provider',
  title: 'Talk to any model',
  tagline: 'Anthropic/Codex/OpenAI/Gemini',
  body: (
    <Box flexDirection="column" gap={1}>
      <Text>
        ccb talks to every major model family through one agent loop. The
        same tools, MCP servers, agents, and hooks all work — only the
        model behind the curtain changes.
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          <Text color="success">Anthropic OAuth</Text> — sign in with your
          Pro / Max account; no API key needed.
        </Text>
        <Text>
          <Text color="success">Anthropic-compatible</Text> — any endpoint
          that speaks the Anthropic API (proxies, gateways).
        </Text>
        <Text>
          <Text color="success">ChatGPT Codex OAuth</Text> — sign in with
          your ChatGPT Plus / Pro / Business / Enterprise account.
        </Text>
        <Text>
          <Text color="success">OpenAI-compatible</Text> — Ollama, DeepSeek,
          vLLM, anything that speaks Chat Completions.
        </Text>
        <Text>
          <Text color="success">Gemini</Text> — Google AI Studio API key.
        </Text>
      </Box>
      <FrameAnimation
        frames={[
          '> [suggestion:/login]\n#add a new connection…',
          '#─ Connections ─\n#  [success:✓] claude-account   anthropic\n#  [success:✓] my-openai       openai',
          '> [suggestion:/model]\n#  [claude:●] claude-opus-4-7\n#  ◯ gpt-5.5\n#  ◯ gemini-3-pro',
        ]}
      />
      <Text>
        Run <Text color="suggestion">/login</Text> to add a connection,{' '}
        <Text color="suggestion">/model</Text> to switch between them. Each
        connection stores its own credentials and base URL — log in once,
        flip mid-session whenever you want.
      </Text>
    </Box>
  ),
}
