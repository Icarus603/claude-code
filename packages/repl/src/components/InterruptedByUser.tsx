import * as React from 'react'
import { Text } from '@anthropic/ink'

export function InterruptedByUser(): React.ReactNode {
  return (
    <>
      <Text dimColor>Interrupted </Text>
      <Text dimColor>· What should Claude do instead?</Text>
    </>
  )
}
