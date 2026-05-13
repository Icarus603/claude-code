/**
 * IneffectivePluginDisables — port of ant v2.1.133 GHK (4171.js).
 *
 * Renders inside the Doctor screen. Reads `detectIneffectiveDisables()`
 * from `@claude-code/config/plugin/ineffectiveDisables.js` and shows
 * each plugin that the user disabled in `userSettings` but which a
 * higher-precedence settings layer (project / local / flag / managed
 * policy) still re-enables. Empty state renders nothing.
 */
import * as React from 'react'
import { useMemo } from 'react'
import { Box, Text } from '@anthropic/ink'
import {
  detectIneffectiveDisables,
  formatIneffectiveDisable,
  type IneffectiveDisable,
} from '@claude-code/config/plugin/ineffectiveDisables.js'

export function IneffectivePluginDisables(): React.ReactNode {
  const items: IneffectiveDisable[] = useMemo(
    () => detectIneffectiveDisables(),
    [],
  )
  if (items.length === 0) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Plugin settings overridden</Text>
      {items.map(d => (
        <Text key={`${d.pluginId}:${d.overriddenBy}`} color="warning">
          └ {formatIneffectiveDisable(d)}
        </Text>
      ))}
    </Box>
  )
}
