/**
 * Structured "Needs input" question + options renderer.
 *
 * Source: ant 5091.js KdK + Ys3 (verbatim port). Used by gs3 when
 * state.tempo === "blocked" AND state.block.questions exists. Renders:
 *
 *   <age> <bold question> +N more · enter to open
 *      1. option label · description
 *      2. option label · description
 *      ...
 *   or type your own answer below
 *
 * ant KdK reads `T = questions[0]`. Only the first question is shown
 * here — additional questions are summarised as "+N more · enter to
 * open" hint (ant renders this as a hint string, not actionable from
 * peek; the user's only paths are pick a numbered option, type a
 * custom reply, or attach via right arrow / Enter on empty).
 */

import type React from 'react'
import { Box, Text, type Theme } from '@anthropic/ink'

import type {
  FleetBlockQuestion,
  FleetBlockQuestionOption,
} from '@claude-code/agent/background/fleet/fleetTypes.js'

interface BlockedQuestionsPromptProps {
  /** Source: ant H.questions — at least one element checked by caller. */
  questions: readonly FleetBlockQuestion[]
  /** Source: ant H.ageLabel — short age string ("2h"). */
  ageLabel: string
  /** Source: ant H.ageColor — colored Text wrapper for age. */
  ageColor?: keyof Theme
}

/** Source: ant Ys3 (5091.js). */
function Option({
  option,
  index,
}: {
  option: FleetBlockQuestionOption
  index: number
}): React.ReactNode {
  return (
    <Box paddingLeft={2}>
      <Box width={3} flexShrink={0}>
        <Text dimColor>{index + 1}.</Text>
      </Box>
      <Box flexGrow={1} width={0}>
        <Text wrap="truncate">
          {option.label}
          {option.description !== '' ? (
            <Text dimColor> · {option.description}</Text>
          ) : null}
        </Text>
      </Box>
    </Box>
  )
}

/** Source: ant KdK (5091.js). */
export function BlockedQuestionsPrompt({
  questions,
  ageLabel,
  ageColor,
}: BlockedQuestionsPromptProps): React.ReactNode {
  const first = questions[0]
  if (first === undefined) return null
  const overflow = questions.length - 1
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={ageColor}>{ageLabel}</Text>
        <Text> </Text>
        <Box flexGrow={1} width={0}>
          <Text bold wrap="truncate">
            {first.question}
          </Text>
        </Box>
        {overflow > 0 ? (
          <Box flexShrink={0} paddingLeft={1}>
            <Text dimColor>+{overflow} more · enter to open</Text>
          </Box>
        ) : null}
      </Box>
      {first.options.map((option, index) => (
        <Option key={option.label} option={option} index={index} />
      ))}
      <Box paddingLeft={5}>
        <Text dimColor>or type your own answer below</Text>
      </Box>
    </Box>
  )
}

/**
 * Resolve a 1-9 keypress to the matching option label.
 * Source: ant 5091.js OdK verbatim:
 *
 *   function OdK(H, _) {
 *     let q = _?.[0];
 *     if (!q || H < "1" || H > "9") return null;
 *     let K = Number(H) - 1;
 *     return q.options[K]?.label ?? null;
 *   }
 *
 * H = the key character. _ = the questions array.
 */
export function pickOptionLabelByKey(
  key: string,
  questions: readonly FleetBlockQuestion[] | undefined,
): string | null {
  const first = questions?.[0]
  if (first === undefined) return null
  if (key < '1' || key > '9') return null
  const index = Number(key) - 1
  return first.options[index]?.label ?? null
}
