/**
 * Contract: buildTranscriptEntries must EXCLUDE meta user messages from the
 * transcript fed to the auto-mode classifier.
 *
 * WHY THIS EXISTS — meta user messages (isMeta:true) are system-injected
 * context, not real user intent: system-reminders, UserPromptSubmit hook
 * additional-context, screenshot/file attachment notices, etc. (stamped
 * isMeta:true at creation; see messages.ts createUserMessage callers). When
 * they leaked into the classifier transcript, the model latched onto stale meta
 * content — a screenshot path under /var/folders, an earlier CI-log discussion —
 * and fabricated an unrelated deny reason for the action actually being
 * classified (e.g. denying `git status` with "reading CI failure log that may
 * contain sensitive information"). ant filters these in `gZ7` (2.1.150
 * 3149.js:202: `if (K.isMeta) continue`); ccb's port had dropped that line.
 *
 * Real (non-meta) user turns must still pass through — the classifier needs
 * genuine user intent to authorize actions. These assertions lock both sides.
 */
import { describe, expect, test } from 'bun:test'

import { buildTranscriptEntries } from '../yoloClassifier.js'
import type { Message } from '@claude-code/agent/messageShapes'

function userMsg(text: string, isMeta = false): Message {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    ...(isMeta ? { isMeta: true } : {}),
    message: { role: 'user', content: text },
  } as unknown as Message
}

describe('buildTranscriptEntries — meta filtering (ant gZ7 parity)', () => {
  test('drops meta user messages, keeps real ones', () => {
    const messages = [
      userMsg('real user intent: refactor the parser', false),
      userMsg('<system-reminder>CAVEMAN MODE ACTIVE</system-reminder>', true),
      userMsg('screenshot at /var/folders/xx/T/screencaptureui/foo.png', true),
      userMsg('also please add tests', false),
    ]
    const entries = buildTranscriptEntries(messages)
    const texts = entries.flatMap(e =>
      e.content.flatMap(b => (b.type === 'text' ? [b.text] : [])),
    )
    expect(texts).toEqual([
      'real user intent: refactor the parser',
      'also please add tests',
    ])
  })

  test('a transcript of only meta user messages yields no user entries', () => {
    const messages = [
      userMsg('<system-reminder>hook additional context</system-reminder>', true),
      userMsg('UserPromptSubmit hook: CAVEMAN MODE', true),
    ]
    const entries = buildTranscriptEntries(messages)
    expect(entries.filter(e => e.role === 'user')).toHaveLength(0)
  })

  test('non-meta user message with no isMeta field is kept', () => {
    const entries = buildTranscriptEntries([userMsg('plain message')])
    expect(entries).toHaveLength(1)
    expect(entries[0]!.role).toBe('user')
  })
})

describe('buildTranscriptEntries — AskUserQuestion answers (ant gZ7 parity)', () => {
  function askMsg(id: string): Message {
    return {
      type: 'assistant',
      uuid: crypto.randomUUID(),
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id, name: 'AskUserQuestion', input: {} },
        ],
      },
    } as unknown as Message
  }

  function answerMsg(
    toolUseId: string,
    answer: string,
    isError = false,
  ): Message {
    return {
      type: 'user',
      uuid: crypto.randomUUID(),
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            is_error: isError,
            content: answer,
          },
        ],
      },
    } as unknown as Message
  }

  test('folds the user answer to a prior AskUserQuestion into the transcript', () => {
    const entries = buildTranscriptEntries([
      askMsg('toolu_ask1'),
      answerMsg('toolu_ask1', 'Yes, deploy to prod'),
    ])
    const userTexts = entries
      .filter(e => e.role === 'user')
      .flatMap(e =>
        e.content.flatMap(b => (b.type === 'text' ? [b.text] : [])),
      )
    expect(userTexts).toEqual([
      '[User answered AskUserQuestion]: Yes, deploy to prod',
    ])
  })

  test('ignores a tool_result with no matching AskUserQuestion call', () => {
    // Bare tool_result (e.g. a Bash result) is NOT a user answer — must not
    // leak into the transcript as fake user intent.
    const entries = buildTranscriptEntries([
      answerMsg('toolu_unknown', 'some bash output'),
    ])
    expect(entries.filter(e => e.role === 'user')).toHaveLength(0)
  })

  test('ignores an errored AskUserQuestion tool_result', () => {
    const entries = buildTranscriptEntries([
      askMsg('toolu_ask2'),
      answerMsg('toolu_ask2', 'error text', true),
    ])
    expect(entries.filter(e => e.role === 'user')).toHaveLength(0)
  })
})
