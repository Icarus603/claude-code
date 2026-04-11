import type { SDKUserMessage } from '../entrypoints/agentSdkTypes.js'
import { fromArray } from '../utils/generators.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { RemoteIO } from './remoteIO.js'
import { StructuredIO } from './structuredIO.js'

export function getStructuredIO(
  inputPrompt: string | AsyncIterable<string>,
  options: {
    sdkUrl: string | undefined
    replayUserMessages?: boolean
  },
): StructuredIO {
  let inputStream: AsyncIterable<string>
  if (typeof inputPrompt === 'string') {
    if (inputPrompt.trim() !== '') {
      inputStream = fromArray([
        jsonStringify({
          type: 'user',
          content: inputPrompt,
          uuid: '',
          session_id: '',
          message: {
            role: 'user',
            content: inputPrompt,
          },
          parent_tool_use_id: null,
        } satisfies SDKUserMessage),
      ])
    } else {
      inputStream = fromArray([])
    }
  } else {
    inputStream = inputPrompt
  }

  return options.sdkUrl
    ? new RemoteIO(options.sdkUrl, inputStream, options.replayUserMessages)
    : new StructuredIO(inputStream, options.replayUserMessages)
}
