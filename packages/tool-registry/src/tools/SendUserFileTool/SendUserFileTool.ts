import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import { getFeatureValue_CACHED_WITH_REFRESH } from '@claude-code/config/feature-flags'
import { isEnvTruthy } from '@claude-code/config/env/utils'
import { logEvent } from '@claude-code/local-observability'
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from '@claude-code/provider/providers.js'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { plural } from '@claude-code/output/utils/stringUtils.js'
import { isBriefEnabled } from '../BriefTool/BriefTool.js'
import { resolveAttachments, validateAttachmentPaths } from '../BriefTool/attachments.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'
import {
  DESCRIPTION,
  SEND_USER_FILE_TOOL_NAME,
  SEND_USER_FILE_TOOL_PROMPT,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    files: z
      .array(z.string())
      .min(1)
      .describe('File paths (absolute or relative to cwd) to send to the user.'),
    caption: z.string().optional().describe('Optional short caption for the file(s).'),
    status: z
      .enum(['normal', 'proactive'])
      .describe(
        "Use 'proactive' when you're surfacing a file the user hasn't asked for and needs to see now — a generated artifact, a completed report. Use 'normal' when replying to something the user just said.",
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    caption: z.string().optional(),
    attachments: z
      .array(
        z.object({
          path: z.string(),
          size: z.number(),
          isImage: z.boolean(),
          file_uuid: z.string().optional(),
        }),
      )
      .describe('Resolved file metadata'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const SEND_USER_FILE_REFRESH_MS = 5 * 60 * 1000

function isRemoteEnvironment(): boolean {
  return !!(
    process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE ||
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
  )
}

function isSendUserFileEnabled(): boolean {
  if (!feature('KAIROS_SEND_USER_FILE')) return false
  if (getAPIProvider() !== 'firstParty' || !isFirstPartyAnthropicBaseUrl()) {
    return false
  }
  if (isBriefEnabled()) return false
  if (
    !getFeatureValue_CACHED_WITH_REFRESH(
      'tengu_send_user_file',
      true,
      SEND_USER_FILE_REFRESH_MS,
    )
  ) {
    return false
  }
  return isRemoteEnvironment()
}

export const SendUserFileTool = buildTool({
  name: SEND_USER_FILE_TOOL_NAME,
  searchHint: 'deliver files (screenshots, reports, artifacts) to the user',
  maxResultSizeChars: 100_000,
  userFacingName() {
    return ''
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isSendUserFileEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.caption ?? `[${input.files.length} file(s)]`
  },
  async validateInput({ files }): Promise<ValidationResult> {
    return validateAttachmentPaths(files)
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return SEND_USER_FILE_TOOL_PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const n = output.attachments.length
    const uploaded = output.attachments
      .filter(a => a.file_uuid !== undefined)
      .map(a => `  ${a.path} → file_uuid: ${a.file_uuid}`)
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content:
        `${n} ${plural(n, 'file')} delivered to user.` +
        (uploaded.length > 0 ? `\n${uploaded.join('\n')}` : ''),
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call({ files, caption, status }, context) {
    logEvent('tengu_send_user_file', {
      proactive: status === 'proactive',
      file_count: files.length,
    })
    const appState = context.getAppState()
    const attachments = await resolveAttachments(files, {
      replBridgeEnabled: appState.replBridgeEnabled,
      signal: context.abortController.signal,
    })
    return { data: { caption, attachments } }
  },
} satisfies ToolDef<InputSchema, Output>)
