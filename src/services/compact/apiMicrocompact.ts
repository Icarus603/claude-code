import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import { WEB_FETCH_TOOL_NAME } from 'src/tools/WebFetchTool/prompt.js'
import { WEB_SEARCH_TOOL_NAME } from 'src/tools/WebSearchTool/prompt.js'
import { SHELL_TOOL_NAMES } from 'src/utils/shell/shellToolUtils.js'

export type {
  ContextEditStrategy,
  ContextManagementConfig,
} from '../../../packages/agent/types/compaction.js'

import {
  getAPIContextManagement as getAPIContextManagementImpl,
} from '../../../packages/agent/compaction/apiMicrocompact.js'

export function getAPIContextManagement(options?: {
  hasThinking?: boolean
  isRedactThinkingActive?: boolean
  clearAllThinking?: boolean
}) {
  return getAPIContextManagementImpl(
    {
      toolNames: {
        fileEdit: FILE_EDIT_TOOL_NAME,
        fileRead: FILE_READ_TOOL_NAME,
        fileWrite: FILE_WRITE_TOOL_NAME,
        glob: GLOB_TOOL_NAME,
        grep: GREP_TOOL_NAME,
        webFetch: WEB_FETCH_TOOL_NAME,
        webSearch: WEB_SEARCH_TOOL_NAME,
        notebookEdit: NOTEBOOK_EDIT_TOOL_NAME,
        shellToolNames: SHELL_TOOL_NAMES,
      },
      getEnv: (key: string) => process.env[key],
    },
    options,
  )
}
