import figures from 'figures'
import * as React from 'react'
import { Box, Text, StatusIcon } from '@anthropic/ink'
import type { ContextSuggestion } from '@claude-code/agent/sessionTools/contextSuggestions.js'
import { formatTokens } from '@claude-code/output/formatters'

type Props = {
  suggestions: ContextSuggestion[]
}

export function ContextSuggestions({ suggestions }: Props): React.ReactNode {
  if (suggestions.length === 0) return null

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Suggestions</Text>
      {suggestions.map((suggestion, i) => (
        <Box key={i} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
          <Box>
            <StatusIcon status={suggestion.severity} withSpace />
            <Text bold>{suggestion.title}</Text>
            {suggestion.savingsTokens ? (
              <Text dimColor>
                {' '}
                {figures.arrowRight} save ~
                {formatTokens(suggestion.savingsTokens)}
              </Text>
            ) : null}
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>{suggestion.detail}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}
