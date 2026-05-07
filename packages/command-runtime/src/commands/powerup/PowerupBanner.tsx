import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import { getUnlocked, isAllUnlocked, totalLessons } from './state.js'

/**
 * One-line banner shown under the LogoV2 welcome panel until all 10
 * power-ups are unlocked. Stays visible across every startup as long as
 * the user has not finished — D-wide strategy from the spec. Once
 * `isAllUnlocked()` returns true the banner disappears permanently
 * (the celebration screen has already fired inside /powerup).
 *
 * Style follows EmergencyTip: a single dimColor line under
 * `paddingLeft={2}` for visual alignment with the rest of the LogoV2
 * footer area. No border, no animation — must blend with the
 * existing notice block.
 */
export function PowerupBanner(): React.ReactNode {
  if (isAllUnlocked()) return null
  const unlocked = getUnlocked().size
  const total = totalLessons()
  return (
    <Box paddingLeft={2}>
      <Text dimColor>
        /powerup · Discover ccb features ({unlocked}/{total})
      </Text>
    </Box>
  )
}
