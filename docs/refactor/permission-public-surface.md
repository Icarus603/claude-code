# @claude-code/permission — exports audit

**Total**: 87  |  Public: 44  |  Internal-only: 0  |  Dead: 40  |  Protected: 4

## Truly dead (safe to remove)

- `./commands/permissions.js` -> `./src/commands/permissions.tsx`
- `./classifierShared.js` -> `./src/classifierShared.ts`
- `./permissionExplainer.js` -> `./src/permissionExplainer.ts`
- `./yolo-classifier-prompts/*.js` -> `./src/yolo-classifier-prompts/*.ts`
- `./components/shellPermissionHelpers.js` -> `./src/components/shellPermissionHelpers.tsx`
- `./components/PermissionRuleExplanation.js` -> `./src/components/PermissionRuleExplanation.tsx`
- `./components/WorkerBadge.js` -> `./src/components/WorkerBadge.tsx`
- `./components/PermissionRequestTitle.js` -> `./src/components/PermissionRequestTitle.tsx`
- `./components/PermissionExplanation.js` -> `./src/components/PermissionExplanation.tsx`
- `./components/FallbackPermissionRequest.js` -> `./src/components/FallbackPermissionRequest.tsx`
- `./components/PermissionPrompt.js` -> `./src/components/PermissionPrompt.tsx`
- `./components/PermissionDecisionDebugInfo.js` -> `./src/components/PermissionDecisionDebugInfo.tsx`
- `./components/NotebookEditPermissionRequest/NotebookEditPermissionRequest.js` -> `./src/components/NotebookEditPermissionRequest/NotebookEditPermissionRequest.tsx`
- `./components/NotebookEditPermissionRequest/NotebookEditToolDiff.js` -> `./src/components/NotebookEditPermissionRequest/NotebookEditToolDiff.tsx`
- `./components/PowerShellPermissionRequest/PowerShellPermissionRequest.js` -> `./src/components/PowerShellPermissionRequest/PowerShellPermissionRequest.tsx`
- `./components/PowerShellPermissionRequest/powershellToolUseOptions.js` -> `./src/components/PowerShellPermissionRequest/powershellToolUseOptions.tsx`
- `./components/SedEditPermissionRequest/SedEditPermissionRequest.js` -> `./src/components/SedEditPermissionRequest/SedEditPermissionRequest.tsx`
- `./components/FilesystemPermissionRequest/FilesystemPermissionRequest.js` -> `./src/components/FilesystemPermissionRequest/FilesystemPermissionRequest.tsx`
- `./components/BashPermissionRequest/BashPermissionRequest.js` -> `./src/components/BashPermissionRequest/BashPermissionRequest.tsx`
- `./components/BashPermissionRequest/bashToolUseOptions.js` -> `./src/components/BashPermissionRequest/bashToolUseOptions.tsx`
- `./components/FileWritePermissionRequest/FileWriteToolDiff.js` -> `./src/components/FileWritePermissionRequest/FileWriteToolDiff.tsx`
- `./components/FileWritePermissionRequest/FileWritePermissionRequest.js` -> `./src/components/FileWritePermissionRequest/FileWritePermissionRequest.tsx`
- `./components/FileEditPermissionRequest/FileEditPermissionRequest.js` -> `./src/components/FileEditPermissionRequest/FileEditPermissionRequest.tsx`
- `./components/AskUserQuestionPermissionRequest/QuestionNavigationBar.js` -> `./src/components/AskUserQuestionPermissionRequest/QuestionNavigationBar.tsx`
- `./components/AskUserQuestionPermissionRequest/PreviewQuestionView.js` -> `./src/components/AskUserQuestionPermissionRequest/PreviewQuestionView.tsx`
- `./components/AskUserQuestionPermissionRequest/PreviewBox.js` -> `./src/components/AskUserQuestionPermissionRequest/PreviewBox.tsx`
- `./components/AskUserQuestionPermissionRequest/QuestionView.js` -> `./src/components/AskUserQuestionPermissionRequest/QuestionView.tsx`
- `./components/AskUserQuestionPermissionRequest/SubmitQuestionsView.js` -> `./src/components/AskUserQuestionPermissionRequest/SubmitQuestionsView.tsx`
- `./components/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.js` -> `./src/components/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx`
- `./components/WebFetchPermissionRequest/WebFetchPermissionRequest.js` -> `./src/components/WebFetchPermissionRequest/WebFetchPermissionRequest.tsx`
- `./components/FilePermissionDialog/FilePermissionDialog.js` -> `./src/components/FilePermissionDialog/FilePermissionDialog.tsx`
- `./components/rules/WorkspaceTab.js` -> `./src/components/rules/WorkspaceTab.tsx`
- `./components/rules/PermissionRuleList.js` -> `./src/components/rules/PermissionRuleList.tsx`
- `./components/rules/RecentDenialsTab.js` -> `./src/components/rules/RecentDenialsTab.tsx`
- `./components/rules/RemoveWorkspaceDirectory.js` -> `./src/components/rules/RemoveWorkspaceDirectory.tsx`
- `./components/rules/PermissionRuleDescription.js` -> `./src/components/rules/PermissionRuleDescription.tsx`
- `./components/rules/AddPermissionRules.js` -> `./src/components/rules/AddPermissionRules.tsx`
- `./components/rules/PermissionRuleInput.js` -> `./src/components/rules/PermissionRuleInput.tsx`
- `./components/SkillPermissionRequest/SkillPermissionRequest.js` -> `./src/components/SkillPermissionRequest/SkillPermissionRequest.tsx`
- `./components/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.js` -> `./src/components/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx`

## Internal-only (safe to remove after relativization)


## Protected entries (kept regardless of usage — V7 §9.11 / API contract)

- `.` (ext=4, int=0) -> `./src/index.ts`
- `./contracts` (ext=0, int=0) -> `./src/contracts.ts`
- `./errors` (ext=0, int=0) -> `./src/errors.ts`
- `./testing` (ext=0, int=0) -> `./src/testing/index.ts`

## Public surface

- `./PermissionResult` (ext=31, int=0) -> `./src/PermissionResult.ts`
- `./filesystem` (ext=30, int=0) -> `./src/filesystem.ts`
- `./PermissionMode` (ext=26, int=0) -> `./src/PermissionMode.ts`
- `./components/*.js` (ext=20, int=0) -> `./src/components/*.ts`
- `./permissionTypes` (ext=20, int=0) -> `./src/permissionTypes.ts`
- `./permissions` (ext=17, int=0) -> `./src/permissions.ts`
- `./permissionSetup` (ext=16, int=0) -> `./src/permissionSetup.ts`
- `./PermissionUpdate` (ext=11, int=0) -> `./src/PermissionUpdate.ts`
- `./PermissionUpdateSchema` (ext=10, int=0) -> `./src/PermissionUpdateSchema.ts`
- `./components/PermissionDialog.js` (ext=10, int=0) -> `./src/components/PermissionDialog.tsx`
- `./autoModeState.js` (ext=7, int=0) -> `./src/autoModeState.ts`
- `./shellRuleMatching.js` (ext=7, int=0) -> `./src/shellRuleMatching.ts`
- `./components/PermissionRequest.js` (ext=7, int=0) -> `./src/components/PermissionRequest.tsx`
- `./shellRuleMatching` (ext=7, int=0) -> `./src/shellRuleMatching.ts`
- `./permissionRuleParser` (ext=6, int=0) -> `./src/permissionRuleParser.ts`
- `./PermissionRule` (ext=5, int=0) -> `./src/PermissionRule.ts`
- `./classifierApprovals.js` (ext=5, int=0) -> `./src/classifierApprovals.ts`
- `.` (ext=4, int=0) -> `./src/index.ts`
- `./yoloClassifier.js` (ext=4, int=0) -> `./src/yoloClassifier.ts`
- `./PermissionPromptToolResultSchema` (ext=3, int=0) -> `./src/PermissionPromptToolResultSchema.ts`
- `./denialTracking` (ext=3, int=0) -> `./src/denialTracking.ts`
- `./commands/add-dir/validation.js` (ext=3, int=0) -> `./src/commands/add-dir/validation.ts`
- `./pathValidation.js` (ext=3, int=0) -> `./src/pathValidation.ts`
- `./permissionsLoader.js` (ext=3, int=0) -> `./src/permissionsLoader.ts`
- `./planModeV2.js` (ext=3, int=0) -> `./src/planModeV2.ts`
- `./toolPermission/*.js` (ext=2, int=0) -> `./src/toolPermission/*.ts`
- `./classifierDecision.js` (ext=2, int=0) -> `./src/classifierDecision.ts`
- `./getNextPermissionMode.js` (ext=2, int=0) -> `./src/getNextPermissionMode.ts`
- `./bypassPermissionsKillswitch.js` (ext=2, int=0) -> `./src/bypassPermissionsKillswitch.ts`
- `./commands/index.js` (ext=1, int=0) -> `./src/commands/index.ts`
- `./commands/rename/generateSessionName.js` (ext=1, int=0) -> `./src/commands/rename/generateSessionName.ts`
- `./toolPermission/handlers/*.js` (ext=1, int=0) -> `./src/toolPermission/handlers/*.ts`
- `./dangerousPatterns.js` (ext=1, int=0) -> `./src/dangerousPatterns.ts`
- `./bashClassifier.js` (ext=1, int=0) -> `./src/bashClassifier.ts`
- `./shadowedRuleDetection.js` (ext=1, int=0) -> `./src/shadowedRuleDetection.ts`
- `./components/SandboxPermissionRequest.js` (ext=1, int=0) -> `./src/components/SandboxPermissionRequest.tsx`
- `./components/WorkerPendingPermission.js` (ext=1, int=0) -> `./src/components/WorkerPendingPermission.tsx`
- `./components/ComputerUseApproval/ComputerUseApproval.js` (ext=1, int=0) -> `./src/components/ComputerUseApproval/ComputerUseApproval.tsx`
- `./components/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.js` (ext=1, int=0) -> `./src/components/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`
- `./components/FilePermissionDialog/permissionOptions.js` (ext=1, int=0) -> `./src/components/FilePermissionDialog/permissionOptions.tsx`
- `./components/rules/AddWorkspaceDirectory.js` (ext=1, int=0) -> `./src/components/rules/AddWorkspaceDirectory.tsx`
- `./dangerousPatterns` (ext=1, int=0) -> `./src/dangerousPatterns.ts`
- `./classifierApprovalsHook.js` (ext=1, int=0) -> `./src/classifierApprovalsHook.ts`
- `./autoModeDenials.js` (ext=1, int=0) -> `./src/autoModeDenials.ts`
