import type { Tool } from '../../Tool.js'
import { AgentTool } from '../AgentTool/AgentTool.js'
import { BashTool } from '../BashTool/BashTool.js'
import { FileEditTool } from '@claude-code/tool-registry/tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '@claude-code/tool-registry/tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '@claude-code/tool-registry/tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from '@claude-code/tool-registry/tools/GlobTool/GlobTool.js'
import { GrepTool } from '@claude-code/tool-registry/tools/GrepTool/GrepTool.js'
import { NotebookEditTool } from '@claude-code/tool-registry/tools/NotebookEditTool/NotebookEditTool.js'

let _primitiveTools: readonly Tool[] | undefined

/**
 * Primitive tools hidden from direct model use when REPL mode is on
 * (REPL_ONLY_TOOLS) but still accessible inside the REPL VM context.
 * Exported so display-side code (collapseReadSearch, renderers) can
 * classify/render virtual messages for these tools even when they're
 * absent from the filtered execution tools list.
 *
 * Lazy getter — the import chain collapseReadSearch.ts → primitiveTools.ts
 * → FileReadTool.tsx → ... loops back through the tool registry, so a
 * top-level const hits "Cannot access before initialization". Deferring
 * to call time avoids the TDZ.
 *
 * Referenced directly rather than via getAllBaseTools() because that
 * excludes Glob/Grep when hasEmbeddedSearchTools() is true.
 */
export function getReplPrimitiveTools(): readonly Tool[] {
  return (_primitiveTools ??= [
    FileReadTool,
    FileWriteTool,
    FileEditTool,
    GlobTool,
    GrepTool,
    BashTool,
    NotebookEditTool,
    AgentTool,
  ])
}
