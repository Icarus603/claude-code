/**
 * Contract tests for the SendMessage tool prompt's broadcast guidance.
 *
 * Why this exists: the operator's 2026-04-30 e2e probe showed that the
 * model called `SendMessage(to: "*", message: {type: "shutdown_request"})`
 * trying to shut down all teammates at once, hit the broadcast guard,
 * and had to retry by fanning out manually. The prompt and error
 * message are now explicit about the limitation; these tests lock the
 * teaching so future prompt edits don't silently regress it.
 *
 * The error message at SendMessageTool.ts is also tested here (string
 * match) because the model reads it on failure and the wording is the
 * recovery instruction.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { getPrompt } from '../prompt.js'

const promptText = getPrompt()
const HERE = dirname(fileURLToPath(import.meta.url))
const sendMessageToolSource = readFileSync(
  join(HERE, '..', 'SendMessageTool.ts'),
  'utf8',
)

describe('SendMessage prompt — broadcast restriction is documented', () => {
  test('broadcast row explicitly says plain-text only', () => {
    expect(promptText).toMatch(/plain[- ]text only/i)
  })

  test('mentions the structured-message rejection in the broadcast row', () => {
    expect(promptText).toContain('shutdown_request')
    expect(promptText).toContain('plan_approval_request')
    // Wording must surface "rejected" / "rejects" so the model reads
    // it as a hard constraint, not a hint.
    expect(promptText).toMatch(/reject/i)
  })

  test('explains the why (per-recipient requestId)', () => {
    expect(promptText).toMatch(/requestId/i)
    expect(promptText).toMatch(/demultiplex|tracking/i)
  })

  test('teaches the fan-out alternative explicitly', () => {
    expect(promptText).toMatch(/fan[- ]out|once per teammate/i)
  })

  test('Protocol responses section warns against "to: \\*" for protocol messages', () => {
    // The tail of the Protocol responses section explicitly tells the
    // model not to broadcast protocol messages.
    expect(promptText).toMatch(
      /Do NOT use\s+`to: "\*"`\s+for protocol messages/,
    )
  })
})

describe('SendMessage tool — broadcast guard error messages teach recovery', () => {
  test('canUseTool guard returns the teaching message (not just "cannot")', () => {
    // The canUseTool branch (early-rejection) — its error string is
    // what the model sees when it tries to broadcast a structured
    // message. It MUST be teaching, not terse.
    expect(sendMessageToolSource).toMatch(
      /structured messages must be sent individually \(to: "<name>"\)/,
    )
  })

  test('canUseTool error explains why broadcast cannot work', () => {
    expect(sendMessageToolSource).toMatch(/requestId.*demultiplex/)
  })

  test('canUseTool error tells the model what to do instead', () => {
    expect(sendMessageToolSource).toMatch(
      /call SendMessage once per teammate name/,
    )
  })

  test('defensive throw at the call site mirrors the teaching', () => {
    // The fallback throw inside `call()` — same wording so the
    // operator does not get a different error for the same condition.
    expect(sendMessageToolSource).toMatch(
      /must be sent individually.*broadcast.*for plain-text DMs only/,
    )
  })
})
