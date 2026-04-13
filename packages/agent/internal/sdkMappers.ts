import stripAnsi from 'strip-ansi'

const SYNTHETIC_MODEL = '<synthetic>'

type PreservedSegment = {
  headUuid: string
  anchorUuid: string
  tailUuid: string
}

type CompactMetadata = {
  trigger?: unknown
  preTokens?: unknown
  preservedSegment?: PreservedSegment
}

type SDKCompactMetadata = {
  trigger?: unknown
  pre_tokens?: unknown
  preserved_segment?: {
    head_uuid: string
    anchor_uuid: string
    tail_uuid: string
  }
}

type SDKAssistantMessage = {
  type: 'assistant'
  content: Array<{ type: 'text'; text: string }>
  message: {
    id: string
    model: string
    role: 'assistant'
    content: Array<{ type: 'text'; text: string }>
    stop_reason: 'end_turn'
    usage: {
      input_tokens: number
      output_tokens: number
    }
  }
  parent_tool_use_id: null
  session_id: string
  uuid: string
}

export function toSDKCompactMetadata(
  meta: CompactMetadata,
): SDKCompactMetadata {
  const seg = meta.preservedSegment
  return {
    trigger: meta.trigger,
    pre_tokens: meta.preTokens,
    ...(seg
      ? {
          preserved_segment: {
            head_uuid: seg.headUuid,
            anchor_uuid: seg.anchorUuid,
            tail_uuid: seg.tailUuid,
          },
        }
      : {}),
  }
}

export function localCommandOutputToSDKAssistantMessage(
  rawContent: string,
  uuid: string,
  sessionId: string,
  stdoutTag: string,
  stderrTag: string,
): SDKAssistantMessage {
  const cleanContent = stripAnsi(rawContent)
    .replace(
      new RegExp(`<${stdoutTag}>([\\s\\S]*?)</${stdoutTag}>`),
      '$1',
    )
    .replace(
      new RegExp(`<${stderrTag}>([\\s\\S]*?)</${stderrTag}>`),
      '$1',
    )
    .trim()

  const content = [
    {
      type: 'text' as const,
      text: cleanContent === '' ? '[No content]' : cleanContent,
    },
  ]

  return {
    type: 'assistant',
    content,
    message: {
      id: `synthetic-${uuid}`,
      model: SYNTHETIC_MODEL,
      role: 'assistant',
      content,
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid,
  }
}
