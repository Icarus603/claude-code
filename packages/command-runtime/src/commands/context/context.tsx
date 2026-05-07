import { feature } from 'bun:bundle'
import * as React from 'react'
import type { LocalJSXCommandContext } from '../../runtime.js'
import { ContextVisualization } from '@claude-code/repl/components/ContextVisualization.js'
import { microcompactMessages } from '@claude-code/agent/compaction/microCompact.js'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import type { Message } from '@claude-code/agent/messageShapes'
import { analyzeContextUsage } from '@claude-code/agent/sessionTools/analyzeContext.js'
import { getMessagesAfterCompactBoundary } from '@claude-code/agent/messages.js'
import { renderToAnsiString } from '@claude-code/output/render'

/**
 * Apply the same context transforms query.ts does before the API call, so
 * /context shows what the model actually sees rather than the REPL's raw
 * history. Without projectView the token count overcounts by however much
 * was collapsed — user sees "180k, 3 spans collapsed" when the API sees 120k.
 */
function toApiView(messages: Message[]): Message[] {
  let view = getMessagesAfterCompactBoundary(messages)
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { projectView } =
      require('@claude-code/agent/contextCollapse/operations.js') as typeof import('@claude-code/agent/contextCollapse/operations.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    view = projectView(view)
  }
  return view
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  const {
    messages,
    getAppState,
    options: { mainLoopModel, tools },
  } = context

  const apiView = toApiView(messages)

  // Apply microcompact to get accurate representation of messages sent to API
  const { messages: compactedMessages } = await microcompactMessages(apiView)

  // Get terminal width for responsive sizing
  const terminalWidth = process.stdout.columns || 80

  const appState = getAppState()

  // Analyze context with compacted messages
  // Pass original messages as last parameter for accurate API usage extraction
  const data = await analyzeContextUsage(
    compactedMessages,
    mainLoopModel,
    async () => appState.toolPermissionContext,
    tools,
    appState.agentDefinitions,
    terminalWidth,
    context as unknown as Parameters<typeof analyzeContextUsage>[6], // Pass full context for system prompt calculation
    undefined, // mainThreadAgentDefinition
    apiView, // Original messages for API usage extraction
  )

  // Render to ANSI string to preserve colors and pass to onDone like local commands do.
  // Pass terminal width so layout matches the user's actual terminal — without it,
  // renderToAnsiString falls back to 80 and long category lines wrap visibly even
  // on wide terminals.
  const output = await renderToAnsiString(
    <ContextVisualization data={data} />,
    terminalWidth,
  )
  onDone(output)
  return null
}
