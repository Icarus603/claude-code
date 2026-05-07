import { parseSSEFrames } from './sseParser.js'
import { getProviderNetworkLayer } from '../network.js'
import { errorMessage } from '../runtimeHelpers.js'
import { StreamError, UpstreamError } from '../errors.js'
import type {
  GeminiGenerateContentRequest,
  GeminiStreamChunk,
} from './types.js'
import { readEnv } from '@claude-code/config/env'
import { resolveConnectionForModel } from '../providers.js'

const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta'

const STREAM_DECODE_OPTS: TextDecodeOptions = { stream: true }

/**
 * Per-model resolution: prefer the matching Gemini connection's
 * endpoint+key over env vars. Falls back to env vars (legacy single-
 * provider mode) when no connection matches.
 */
function getGeminiAuth(model: string): { baseUrl: string; apiKey: string } {
  const conn = resolveConnectionForModel(model)
  const usingConn = conn?.protocol === 'gemini' && conn.auth.type === 'api_key'
  return {
    baseUrl: (
      usingConn ? conn.endpoint : readEnv('GEMINI_BASE_URL') || DEFAULT_GEMINI_BASE_URL
    ).replace(/\/+$/, ''),
    apiKey: usingConn
      ? conn.auth.type === 'api_key'
        ? conn.auth.key
        : ''
      : readEnv('GEMINI_API_KEY') || '',
  }
}

function getGeminiModelPath(model: string): string {
  const normalized = model.replace(/^\/+/, '')
  return normalized.startsWith('models/') ? normalized : `models/${normalized}`
}

export async function* streamGeminiGenerateContent(params: {
  model: string
  body: GeminiGenerateContentRequest
  signal: AbortSignal
  fetchOverride?: typeof fetch
}): AsyncGenerator<GeminiStreamChunk, void> {
  const networkLayer = getProviderNetworkLayer()
  const fetchImpl = params.fetchOverride ?? fetch
  const { baseUrl, apiKey } = getGeminiAuth(params.model)
  // modelid:already-unpacked
  // The only caller (gemini/indexImpl.ts) feeds `geminiModel`, which is
  // resolveGeminiModel(options.model) — that fn calls unpackModelId at the
  // top, so by the time we hit this URL build the value is bare.
  const url = `${baseUrl}/${getGeminiModelPath(params.model)}:streamGenerateContent?alt=sse`

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(params.body),
    signal: params.signal,
    ...networkLayer.getProxyFetchOptions({ forAnthropicAPI: false }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new UpstreamError(
      `Gemini API request failed (${response.status} ${response.statusText}): ${body || 'empty response body'}`,
    )
  }

  if (!response.body) {
    throw new StreamError('Gemini API returned no response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, STREAM_DECODE_OPTS)
      const { frames, remaining } = parseSSEFrames(buffer)
      buffer = remaining

      for (const frame of frames) {
        if (!frame.data || frame.data === '[DONE]') continue
        try {
          yield JSON.parse(frame.data) as GeminiStreamChunk
        } catch (error) {
          throw new StreamError(
            `Failed to parse Gemini SSE payload: ${errorMessage(error)}`,
          )
        }
      }
    }

    buffer += decoder.decode()
    const { frames } = parseSSEFrames(buffer)
    for (const frame of frames) {
      if (!frame.data || frame.data === '[DONE]') continue
      try {
        yield JSON.parse(frame.data) as GeminiStreamChunk
      } catch (error) {
        throw new StreamError(
          `Failed to parse trailing Gemini SSE payload: ${errorMessage(error)}`,
        )
      }
    }
  } finally {
    reader.releaseLock()
  }
}
