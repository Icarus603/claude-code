import { z } from 'zod/v4'

const ASK_USER_QUESTION_TIMEOUTS = ['60s', '5m', '10m', 'never'] as const
export type AskUserQuestionTimeout = (typeof ASK_USER_QUESTION_TIMEOUTS)[number]
export const AskUserQuestionTimeoutSchema = z
  .enum(ASK_USER_QUESTION_TIMEOUTS)
  .optional()
  .catch(undefined)
