// Here to break circular dependency from prompt.ts. Prompt.ts reaches
// pdfUtils and BashTool/toolName transitively, which creates a TDZ
// cycle when exploreAgent.ts references the tool name at module-load
// time. Keep this file import-free.
export const FILE_READ_TOOL_NAME = 'Read'
