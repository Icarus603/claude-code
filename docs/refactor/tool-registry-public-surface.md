# @claude-code/tool-registry — exports audit

**Total**: 93  |  Public: 58  |  Internal-only: 0  |  Dead: 33  |  Protected: 4

## Truly dead (safe to remove)

- `./constants` -> `./src/constants.ts`
- `./tools/TaskStopTool/UI.js` -> `./src/tools/TaskStopTool/UI.tsx`
- `./tools/RemoteTriggerTool/UI.js` -> `./src/tools/RemoteTriggerTool/UI.tsx`
- `./tools/EnterPlanModeTool/UI.js` -> `./src/tools/EnterPlanModeTool/UI.tsx`
- `./tools/TeamDeleteTool/UI.js` -> `./src/tools/TeamDeleteTool/UI.tsx`
- `./tools/TeamCreateTool/UI.js` -> `./src/tools/TeamCreateTool/UI.tsx`
- `./tools/ReadMcpResourceTool/UI.js` -> `./src/tools/ReadMcpResourceTool/UI.tsx`
- `./tools/ListMcpResourcesTool/UI.js` -> `./src/tools/ListMcpResourcesTool/UI.tsx`
- `./tools/EnterWorktreeTool/UI.js` -> `./src/tools/EnterWorktreeTool/UI.tsx`
- `./tools/ExitWorktreeTool/UI.js` -> `./src/tools/ExitWorktreeTool/UI.tsx`
- `./tools/GlobTool/UI.js` -> `./src/tools/GlobTool/UI.tsx`
- `./tools/NotebookEditTool/UI.js` -> `./src/tools/NotebookEditTool/UI.tsx`
- `./tools/ConfigTool/UI.js` -> `./src/tools/ConfigTool/UI.tsx`
- `./tools/ExitPlanModeTool/UI.js` -> `./src/tools/ExitPlanModeTool/UI.tsx`
- `./tools/SendMessageTool/UI.js` -> `./src/tools/SendMessageTool/UI.tsx`
- `./tools/WebFetchTool/UI.js` -> `./src/tools/WebFetchTool/UI.tsx`
- `./tools/WebSearchTool/UI.js` -> `./src/tools/WebSearchTool/UI.tsx`
- `./tools/BriefTool/UI.js` -> `./src/tools/BriefTool/UI.tsx`
- `./tools/ScheduleCronTool/UI.js` -> `./src/tools/ScheduleCronTool/UI.tsx`
- `./tools/GrepTool/UI.js` -> `./src/tools/GrepTool/UI.tsx`
- `./tools/SkillTool/UI.js` -> `./src/tools/SkillTool/UI.tsx`
- `./tools/LSPTool/UI.js` -> `./src/tools/LSPTool/UI.tsx`
- `./tools/PowerShellTool/UI.js` -> `./src/tools/PowerShellTool/UI.tsx`
- `./tools/FileReadTool/UI.js` -> `./src/tools/FileReadTool/UI.tsx`
- `./tools/FileWriteTool/UI.js` -> `./src/tools/FileWriteTool/UI.tsx`
- `./tools/FileEditTool/UI.js` -> `./src/tools/FileEditTool/UI.tsx`
- `./tools/BashTool/UI.js` -> `./src/tools/BashTool/UI.tsx`
- `./tools/testing/TestingPermissionTool.js` -> `./src/tools/testing/TestingPermissionTool.tsx`
- `./tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.js` -> `./src/tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.js`
- `./tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.js` -> `./src/tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.js`
- `./validateEditTool.js` -> `./src/validateEditTool.ts`
- `./taskOutput.js` -> `./src/taskOutput.ts`
- `./peerAddress.js` -> `./src/peerAddress.ts`

## Internal-only (safe to remove after relativization)


## Protected entries (kept regardless of usage — V7 §9.11 / API contract)

- `.` (ext=10, int=0) -> `./src/index.ts`
- `./runtime` (ext=9, int=0) -> `./src/runtime.ts`
- `./errors` (ext=0, int=0) -> `./src/errors.ts`
- `./testing` (ext=0, int=0) -> `./src/testing/index.ts`

## Public surface

- `./tools/*.js` (ext=149, int=1) -> `./src/tools/*.ts`
- `./tools/*` (ext=149, int=1) -> `./src/tools/*.ts`
- `./Tool.js` (ext=143, int=0) -> `./src/Tool.ts`
- `./utils/array.js` (ext=44, int=0) -> `./src/utils/array.ts`
- `./utils/lazySchema.js` (ext=33, int=0) -> `./src/utils/lazySchema.ts`
- `./Task.js` (ext=19, int=0) -> `./src/Task.ts`
- `./fileStateCache.js` (ext=16, int=0) -> `./src/fileStateCache.ts`
- `./fileStateCache` (ext=16, int=0) -> `./src/fileStateCache.ts`
- `./tools/BashTool/BashTool.js` (ext=15, int=0) -> `./src/tools/BashTool/BashTool.tsx`
- `./genericTypeUtils` (ext=14, int=0) -> `./src/genericTypeUtils.ts`
- `.` (ext=10, int=0) -> `./src/index.ts`
- `./runtime` (ext=9, int=0) -> `./src/runtime.ts`
- `./ripgrep.js` (ext=9, int=0) -> `./src/ripgrep.ts`
- `./teleport.js` (ext=9, int=0) -> `./src/teleport.tsx`
- `./utils/inkColor.js` (ext=8, int=0) -> `./src/utils/inkColor.ts`
- `./imageStore.js` (ext=8, int=0) -> `./src/imageStore.ts`
- `./tasks/RemoteAgentTask.js` (ext=8, int=0) -> `./src/tasks/RemoteAgentTask.tsx`
- `./collapseReadSearch.js` (ext=7, int=0) -> `./src/collapseReadSearch.ts`
- `./tools/AskUserQuestionTool/AskUserQuestionTool.js` (ext=6, int=0) -> `./src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`
- `./undercover.js` (ext=6, int=0) -> `./src/undercover.ts`
- `./markdownConfigLoader.js` (ext=6, int=0) -> `./src/markdownConfigLoader.ts`
- `./progressTypes` (ext=5, int=0) -> `./src/progressTypes.ts`
- `./diagnosticTracking.js` (ext=5, int=0) -> `./src/diagnosticTracking.ts`
- `./toolsList.js` (ext=5, int=0) -> `./src/toolsList.ts`
- `./telemetry/pluginTelemetry.js` (ext=5, int=0) -> `./src/telemetry/pluginTelemetry.ts`
- `./tools/PowerShellTool/PowerShellTool.js` (ext=4, int=0) -> `./src/tools/PowerShellTool/PowerShellTool.tsx`
- `./toolSchemaCache.js` (ext=4, int=0) -> `./src/toolSchemaCache.ts`
- `./services/*.js` (ext=3, int=0) -> `./src/services/*.ts`
- `./toolConstants` (ext=3, int=0) -> `./src/toolConstants.ts`
- `./words.js` (ext=3, int=0) -> `./src/words.ts`
- `./task/TaskOutput.js` (ext=3, int=0) -> `./src/task/TaskOutput.ts`
- `./skills/skillChangeDetector.js` (ext=3, int=0) -> `./src/skills/skillChangeDetector.ts`
- `./todo/types.js` (ext=3, int=0) -> `./src/todo/types.ts`
- `./tools/AgentTool/AgentTool.js` (ext=2, int=0) -> `./src/tools/AgentTool/AgentTool.tsx`
- `./tools/TungstenTool/TungstenTool.js` (ext=2, int=0) -> `./src/tools/TungstenTool/TungstenTool.js`
- `./notebookTypes` (ext=2, int=0) -> `./src/notebookTypes.ts`
- `./notebook.js` (ext=2, int=0) -> `./src/notebook.ts`
- `./utils/objectGroupBy.js` (ext=2, int=0) -> `./src/utils/objectGroupBy.ts`
- `./toolLimits` (ext=2, int=0) -> `./src/toolLimits.ts`
- `./gitDiff.js` (ext=2, int=0) -> `./src/gitDiff.ts`
- `./claudeCodeHints.js` (ext=2, int=0) -> `./src/claudeCodeHints.ts`
- `./suggestions/skillUsageTracking.js` (ext=2, int=0) -> `./src/suggestions/skillUsageTracking.ts`
- `./toolPool.js` (ext=2, int=0) -> `./src/toolPool.ts`
- `./tools/MCPTool/UI.js` (ext=1, int=0) -> `./src/tools/MCPTool/UI.tsx`
- `./tools/TaskOutputTool/TaskOutputTool.js` (ext=1, int=0) -> `./src/tools/TaskOutputTool/TaskOutputTool.tsx`
- `./tools/BashTool/BashToolResultMessage.js` (ext=1, int=0) -> `./src/tools/BashTool/BashToolResultMessage.tsx`
- `./tools/AgentTool/UI.js` (ext=1, int=0) -> `./src/tools/AgentTool/UI.tsx`
- `./tools/REPLTool/REPLTool.js` (ext=1, int=0) -> `./src/tools/REPLTool/REPLTool.js`
- `./utils/semanticBoolean.js` (ext=1, int=0) -> `./src/utils/semanticBoolean.ts`
- `./utils/semanticNumber.js` (ext=1, int=0) -> `./src/utils/semanticNumber.ts`
- `./readEditContext.js` (ext=1, int=0) -> `./src/readEditContext.ts`
- `./toolErrors.js` (ext=1, int=0) -> `./src/toolErrors.ts`
- `./pdf.js` (ext=1, int=0) -> `./src/pdf.ts`
- `./orphanedPluginFilter.js` (ext=1, int=0) -> `./src/orphanedPluginFilter.ts`
- `./todoTypes.js` (ext=1, int=0) -> `./src/todoTypes.ts`
- `./task/outputFormatting.js` (ext=1, int=0) -> `./src/task/outputFormatting.ts`
- `./codeIndexing.js` (ext=1, int=0) -> `./src/codeIndexing.ts`
- `./generatedFiles.js` (ext=1, int=0) -> `./src/generatedFiles.ts`
