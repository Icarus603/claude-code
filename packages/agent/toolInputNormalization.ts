import type { z } from 'zod/v4'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { getPlatform } from '@claude-code/config/platform'
import { logEvent } from '@claude-code/local-observability'
import {
  getPlan,
  getPlanFilePath,
  persistFileSnapshotIfRemote,
} from '@claude-code/storage/plans.js'
import { windowsPathToPosixPath } from '@claude-code/storage/windowsPaths.js'
import type { AgentId } from '@claude-code/agent/idTypes'
import type { Tool } from '@claude-code/tool-registry/Tool.js'
import { BashTool } from '@claude-code/tool-registry/tools/BashTool/BashTool.js'
import { FileEditTool } from '@claude-code/tool-registry/tools/FileEditTool/FileEditTool.js'
import {
  normalizeFileEditInput,
  stripTrailingWhitespace,
} from '@claude-code/tool-registry/tools/FileEditTool/utils.js'
import { FileWriteTool } from '@claude-code/tool-registry/tools/FileWriteTool/FileWriteTool.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '@claude-code/tool-registry/tools/ExitPlanModeTool/constants.js'
import { TASK_OUTPUT_TOOL_NAME } from '@claude-code/tool-registry/tools/TaskOutputTool/constants.js'

export function normalizeToolInput<T extends Tool>(
  tool: T,
  input: z.infer<T['inputSchema']>,
  agentId?: AgentId,
): z.infer<T['inputSchema']> {
  switch (tool.name) {
    case EXIT_PLAN_MODE_V2_TOOL_NAME: {
      const plan = getPlan(agentId)
      const planFilePath = getPlanFilePath(agentId)
      void persistFileSnapshotIfRemote()
      return plan !== null ? { ...input, plan, planFilePath } : input
    }
    case BashTool.name: {
      const parsed = BashTool.inputSchema.parse(input)
      const { command, timeout, description } = parsed
      const cwd = getCwd()
      let normalizedCommand = command.replace(`cd ${cwd} && `, '')
      if (getPlatform() === 'windows') {
        normalizedCommand = normalizedCommand.replace(
          `cd ${windowsPathToPosixPath(cwd)} && `,
          '',
        )
      }

      normalizedCommand = normalizedCommand.replace(/\\\\;/g, '\\;')

      if (/^echo\s+["']?[^|&;><]*["']?$/i.test(normalizedCommand.trim())) {
        logEvent('tengu_bash_tool_simple_echo', {})
      }

      const run_in_background =
        'run_in_background' in parsed ? parsed.run_in_background : undefined

      return {
        command: normalizedCommand,
        description,
        ...(timeout !== undefined && { timeout }),
        ...(description !== undefined && { description }),
        ...(run_in_background !== undefined && { run_in_background }),
        ...('dangerouslyDisableSandbox' in parsed &&
          parsed.dangerouslyDisableSandbox !== undefined && {
            dangerouslyDisableSandbox: parsed.dangerouslyDisableSandbox,
          }),
      } as z.infer<T['inputSchema']>
    }
    case FileEditTool.name: {
      const parsedInput = FileEditTool.inputSchema.parse(input)
      const { file_path, edits } = normalizeFileEditInput({
        file_path: parsedInput.file_path,
        edits: [
          {
            old_string: parsedInput.old_string,
            new_string: parsedInput.new_string,
            replace_all: parsedInput.replace_all,
          },
        ],
      })

      return {
        replace_all: edits[0]!.replace_all,
        file_path,
        old_string: edits[0]!.old_string,
        new_string: edits[0]!.new_string,
      } as z.infer<T['inputSchema']>
    }
    case FileWriteTool.name: {
      const parsedInput = FileWriteTool.inputSchema.parse(input)
      const isMarkdown = /\.(md|mdx)$/i.test(parsedInput.file_path)
      return {
        file_path: parsedInput.file_path,
        content: isMarkdown
          ? parsedInput.content
          : stripTrailingWhitespace(parsedInput.content),
      } as z.infer<T['inputSchema']>
    }
    case TASK_OUTPUT_TOOL_NAME: {
      const legacyInput = input as Record<string, unknown>
      const taskId =
        legacyInput.task_id ?? legacyInput.agentId ?? legacyInput.bash_id
      const timeout =
        legacyInput.timeout ??
        (typeof legacyInput.wait_up_to === 'number'
          ? legacyInput.wait_up_to * 1000
          : undefined)
      return {
        task_id: taskId ?? '',
        block: legacyInput.block ?? true,
        timeout: timeout ?? 30000,
      } as z.infer<T['inputSchema']>
    }
    default:
      return input
  }
}

export function normalizeToolInputForAPI<T extends Tool>(
  tool: T,
  input: z.infer<T['inputSchema']>,
): z.infer<T['inputSchema']> {
  switch (tool.name) {
    case EXIT_PLAN_MODE_V2_TOOL_NAME: {
      if (
        input &&
        typeof input === 'object' &&
        ('plan' in input || 'planFilePath' in input)
      ) {
        const { plan, planFilePath, ...rest } = input as Record<string, unknown>
        return rest as z.infer<T['inputSchema']>
      }
      return input
    }
    case FileEditTool.name: {
      if (input && typeof input === 'object' && 'edits' in input) {
        const { old_string, new_string, replace_all, ...rest } =
          input as Record<string, unknown>
        return rest as z.infer<T['inputSchema']>
      }
      return input
    }
    default:
      return input
  }
}
