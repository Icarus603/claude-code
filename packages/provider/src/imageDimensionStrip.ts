/**
 * Media block auto-strip retry helper.
 *
 * Ant v2.1.142 broadened the old image-dimension retry into a media-block
 * retry: when the API rejects a specific image/document block, replace that
 * block with a text placeholder and retry the outgoing request copy. This file
 * keeps the historical name for import compatibility, but the implementation is
 * media-aware.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { APIError } from '@anthropic-ai/sdk'

type MediaKind = 'image' | 'document'

export type MediaBlockStripTarget = {
  messageIdx?: number
  contentIdx?: number
  kind: MediaKind
  pixelLimit?: number
}

function isMediaKind(value: string): value is MediaKind {
  return value === 'image' || value === 'document'
}

function mediaPlaceholder(kind: MediaKind, detail?: string): Anthropic.TextBlockParam {
  const label = kind === 'image' ? 'Image' : 'Document'
  return {
    type: 'text',
    text: `[${label} removed: the API could not process this ${kind}${detail ? ` (${detail})` : ''}. Re-read the original file if you need its contents.]`,
  }
}

/**
 * Back-compat export for older callers/tests. Returns targeted coordinates only
 * for image-dimension errors.
 */
export function parseImageDimensionExceededError(
  err: unknown,
):
  | { messageIdx: number; contentIdx: number; pixelLimit?: number }
  | undefined {
  const target = parseMediaBlockStripError(err)
  if (
    target?.kind !== 'image' ||
    target.messageIdx === undefined ||
    target.contentIdx === undefined
  ) {
    return undefined
  }
  return {
    messageIdx: target.messageIdx,
    contentIdx: target.contentIdx,
    pixelLimit: target.pixelLimit,
  }
}

/**
 * Parse API 400s that point at a media block. Supports both precise paths like
 * `messages.3.content.1.document` and broader media errors where the API omits
 * coordinates.
 */
export function parseMediaBlockStripError(
  err: unknown,
): MediaBlockStripTarget | undefined {
  if (!(err instanceof APIError) || err.status !== 400) {
    return undefined
  }
  const msg = err.message ?? ''
  const lower = msg.toLowerCase()

  const coordMatch =
    /messages[.[](\d+)[\].]+content[.[](\d+)[\].]+(?:tool_result[.[]content[.[]\d+[\].]+)?(image|document|pdf)/.exec(
      msg,
    )
  if (coordMatch && isMediaErrorMessage(msg)) {
    const rawKind = coordMatch[3] === 'image' ? 'image' : 'document'
    return {
      messageIdx: Number(coordMatch[1]),
      contentIdx: Number(coordMatch[2]),
      kind: rawKind,
      pixelLimit: extractPixelLimit(msg),
    }
  }

  if (msg.includes('request_too_large') || lower.includes('too much media')) {
    return { kind: 'document' }
  }
  if (
    lower.includes('image dimensions exceed') ||
    lower.includes('image exceeds') ||
    lower.includes('invalid image')
  ) {
    return { kind: 'image', pixelLimit: extractPixelLimit(msg) }
  }
  if (
    lower.includes('pdf') ||
    lower.includes('document') ||
    lower.includes('maximum of')
  ) {
    return { kind: 'document' }
  }
  return undefined
}

function isMediaErrorMessage(msg: string): boolean {
  const lower = msg.toLowerCase()
  return (
    msg.includes('request_too_large') ||
    lower.includes('too much media') ||
    msg.includes('dimensions exceed max allowed size') ||
    lower.includes('image exceeds') ||
    lower.includes('invalid image') ||
    lower.includes('pdf') ||
    lower.includes('document')
  )
}

function extractPixelLimit(msg: string): number | undefined {
  const dimMatch = /dimensions exceed max allowed size.*?(\d+) pixels/.exec(msg)
  return dimMatch ? Number(dimMatch[1]) : undefined
}

/**
 * Back-compat export for older callers/tests.
 */
export function stripOversizedImageFromMessages(
  messages: readonly Anthropic.MessageParam[],
  coords: { messageIdx: number; contentIdx: number },
): readonly Anthropic.MessageParam[] {
  return stripTargetedMediaBlockFromMessages(messages, {
    ...coords,
    kind: 'image',
  })
}

export function stripMediaBlockFromMessages(
  messages: readonly Anthropic.MessageParam[],
  target: MediaBlockStripTarget,
): readonly Anthropic.MessageParam[] {
  if (target.messageIdx !== undefined && target.contentIdx !== undefined) {
    const targeted = stripTargetedMediaBlockFromMessages(messages, target)
    if (targeted !== messages) return targeted
  }
  return stripLatestMediaBlockFromMessages(messages, target.kind)
}

function stripTargetedMediaBlockFromMessages(
  messages: readonly Anthropic.MessageParam[],
  target: Required<Pick<MediaBlockStripTarget, 'messageIdx' | 'contentIdx'>> &
    Pick<MediaBlockStripTarget, 'kind'>,
): readonly Anthropic.MessageParam[] {
  const { messageIdx, contentIdx, kind } = target
  const msg = messages[messageIdx]
  if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) {
    return messages
  }
  const block = msg.content[contentIdx]
  if (!block || block.type !== kind) {
    return messages
  }
  const newContent = msg.content.map((item, idx) =>
    idx === contentIdx ? mediaPlaceholder(kind) : item,
  )
  const newMsg: Anthropic.MessageParam = {
    ...msg,
    content: newContent,
  }
  return messages.map((m, idx) => (idx === messageIdx ? newMsg : m))
}

function stripLatestMediaBlockFromMessages(
  messages: readonly Anthropic.MessageParam[],
  kind: MediaKind,
): readonly Anthropic.MessageParam[] {
  for (let messageIdx = messages.length - 1; messageIdx >= 0; messageIdx--) {
    const msg = messages[messageIdx]
    if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) continue
    for (let contentIdx = msg.content.length - 1; contentIdx >= 0; contentIdx--) {
      const block = msg.content[contentIdx]
      if (block && isMediaKind(block.type) && block.type === kind) {
        return stripTargetedMediaBlockFromMessages(messages, {
          messageIdx,
          contentIdx,
          kind,
        })
      }
    }
  }
  return messages
}
