# @claude-code/provider — exports audit

**Total**: 114  |  Public: 93  |  Internal-only: 0  |  Dead: 20  |  Protected: 3

## Truly dead (safe to remove)

- `./authFileDescriptor.js` -> `./src/authFileDescriptor.ts`
- `./model/modelStrings.js` -> `./src/model/modelStrings.ts`
- `./mockRateLimits.js` -> `./src/mockRateLimits.ts`
- `./commands/login/index.js` -> `./src/commands/login/index.ts`
- `./commands/login/login.js` -> `./src/commands/login/login.tsx`
- `./commands/model/index.js` -> `./src/commands/model/index.ts`
- `./commands/model/model.js` -> `./src/commands/model/model.tsx`
- `./auth.js` -> `./src/auth.ts`
- `./userAuth.js` -> `./src/userAuth.ts`
- `./aws.js` -> `./src/aws.ts`
- `./openai/client.js` -> `./src/openai/client.ts`
- `./openai/index.js` -> `./src/openai/index.ts`
- `./gemini/index.js` -> `./src/gemini/index.ts`
- `./grok/modelMapping.js` -> `./src/grok/modelMapping.ts`
- `./codex/fetchAdapter.js` -> `./src/codex/fetchAdapter.ts`
- `./model/agent.js` -> `./src/model/agent.ts`
- `./model/modelOptions.js` -> `./src/model/modelOptions.ts`
- `./model/validateModel.js` -> `./src/model/validateModel.ts`
- `./model/modelCapabilities.js` -> `./src/model/modelCapabilities.ts`
- `./vcr.js` -> `./src/vcr.ts`

## Internal-only (safe to remove after relativization)


## Protected entries (kept regardless of usage — V7 §9.11 / API contract)

- `.` (ext=13, int=0) -> `./src/index.ts`
- `./errors` (ext=8, int=0) -> `./src/errors.ts`
- `./testing` (ext=0, int=0) -> `./src/testing/index.ts`

## Public surface

- `./authAlias.js` (ext=80, int=0) -> `./src/authAlias.ts`
- `./model.js` (ext=59, int=0) -> `./src/model.ts`
- `./systemPromptType.js` (ext=27, int=0) -> `./src/systemPromptType.ts`
- `./claude.js` (ext=23, int=0) -> `./src/claude.ts`
- `./oauthConstants` (ext=23, int=0) -> `./src/oauthConstants.ts`
- `./context.js` (ext=19, int=0) -> `./src/context.ts`
- `./policyLimits/*.js` (ext=18, int=0) -> `./src/policyLimits/*.ts`
- `./oauth/*.js` (ext=15, int=0) -> `./src/oauth/*.ts`
- `./thinking.js` (ext=15, int=0) -> `./src/thinking.ts`
- `.` (ext=13, int=0) -> `./src/index.ts`
- `./providers.js` (ext=13, int=0) -> `./src/providers.ts`
- `./proxy.js` (ext=11, int=0) -> `./src/proxy.ts`
- `./sessionIngressAuth.js` (ext=10, int=0) -> `./src/sessionIngressAuth.ts`
- `./costTracker.js` (ext=10, int=0) -> `./src/costTracker.ts`
- `./betas.js` (ext=9, int=0) -> `./src/betas.ts`
- `./errors` (ext=8, int=0) -> `./src/errors.ts`
- `./fastMode.js` (ext=8, int=0) -> `./src/fastMode.ts`
- `./dumpPrompts.js` (ext=8, int=0) -> `./src/dumpPrompts.ts`
- `./errors.js` (ext=8, int=0) -> `./src/errors.ts`
- `./mtls.js` (ext=8, int=0) -> `./src/mtls.ts`
- `./http.js` (ext=8, int=0) -> `./src/http.ts`
- `./model/model.js` (ext=8, int=0) -> `./src/model/model.ts`
- `./claudeAiLimits.js` (ext=7, int=0) -> `./src/claudeAiLimits.ts`
- `./referral.js` (ext=7, int=0) -> `./src/referral.ts`
- `./modelAgent.js` (ext=7, int=0) -> `./src/modelAgent.ts`
- `./systemPrompt.js` (ext=7, int=0) -> `./src/systemPrompt.ts`
- `./apiLimits.js` (ext=6, int=0) -> `./src/apiLimits.ts`
- `./promptCacheBreakDetection.js` (ext=6, int=0) -> `./src/promptCacheBreakDetection.ts`
- `./systemPromptSections` (ext=6, int=0) -> `./src/systemPromptSections.ts`
- `./billing.js` (ext=6, int=0) -> `./src/billing.ts`
- `./advisor.js` (ext=6, int=0) -> `./src/advisor.ts`
- `./legacy/api.js` (ext=6, int=0) -> `./src/legacy/api.ts`
- `./connections.js` (ext=6, int=0) -> `./src/connections.ts`
- `./grove.js` (ext=5, int=0) -> `./src/grove.ts`
- `./errorUtils.js` (ext=5, int=0) -> `./src/errorUtils.ts`
- `./modelAliases.js` (ext=5, int=0) -> `./src/modelAliases.ts`
- `./modelOptions.js` (ext=5, int=0) -> `./src/modelOptions.ts`
- `./awsAuthStatusManager.js` (ext=4, int=0) -> `./src/awsAuthStatusManager.ts`
- `./claudeAiLimitsHook.js` (ext=4, int=0) -> `./src/claudeAiLimitsHook.ts`
- `./logging.js` (ext=4, int=0) -> `./src/logging.ts`
- `./user.js` (ext=4, int=0) -> `./src/user.ts`
- `./antModels.js` (ext=4, int=0) -> `./src/antModels.ts`
- `./workloadContext.js` (ext=4, int=0) -> `./src/workloadContext.ts`
- `./modelStrings.js` (ext=4, int=0) -> `./src/modelStrings.ts`
- `./betasConstants.js` (ext=4, int=0) -> `./src/betasConstants.ts`
- `./model/providers.js` (ext=4, int=0) -> `./src/model/providers.ts`
- `./claudeLegacy` (ext=3, int=0) -> `./src/claudeLegacy.ts`
- `./fileConstants.js` (ext=3, int=0) -> `./src/fileConstants.ts`
- `./modelCost.js` (ext=3, int=0) -> `./src/modelCost.ts`
- `./usage.js` (ext=3, int=0) -> `./src/usage.ts`
- `./overageCreditGrant.js` (ext=3, int=0) -> `./src/overageCreditGrant.ts`
- `./sessionIngress.js` (ext=3, int=0) -> `./src/sessionIngress.ts`
- `./filesApi.js` (ext=3, int=0) -> `./src/filesApi.ts`
- `./withRetry.js` (ext=3, int=0) -> `./src/withRetry.ts`
- `./userAgent.js` (ext=3, int=0) -> `./src/userAgent.ts`
- `./authPortable.js` (ext=3, int=0) -> `./src/authPortable.ts`
- `./extraUsage.js` (ext=3, int=0) -> `./src/extraUsage.ts`
- `./model/contextWindowUpgradeCheck.js` (ext=3, int=0) -> `./src/model/contextWindowUpgradeCheck.ts`
- `./modelCapabilities.js` (ext=3, int=0) -> `./src/modelCapabilities.ts`
- `./fingerprint.js` (ext=2, int=0) -> `./src/fingerprint.ts`
- `./model/configs.js` (ext=2, int=0) -> `./src/model/configs.ts`
- `./systemConstants.js` (ext=2, int=0) -> `./src/systemConstants.ts`
- `./cyberRiskInstruction.js` (ext=2, int=0) -> `./src/cyberRiskInstruction.ts`
- `./connectorTextTypes` (ext=2, int=0) -> `./src/connectorTextTypes.ts`
- `./validateModel.js` (ext=2, int=0) -> `./src/validateModel.ts`
- `./model/deprecation.js` (ext=2, int=0) -> `./src/model/deprecation.ts`
- `./providerHostSetup` (ext=1, int=0) -> `./src/providerHostSetup.ts`
- `./model/bedrock.js` (ext=1, int=0) -> `./src/model/bedrock.ts`
- `./model/modelAllowlist.js` (ext=1, int=0) -> `./src/model/modelAllowlist.ts`
- `./model/modelSupportOverrides.js` (ext=1, int=0) -> `./src/model/modelSupportOverrides.ts`
- `./rateLimitMessages.js` (ext=1, int=0) -> `./src/rateLimitMessages.ts`
- `./rateLimitMocking.js` (ext=1, int=0) -> `./src/rateLimitMocking.ts`
- `./commands/provider.js` (ext=1, int=0) -> `./src/commands/provider.ts`
- `./commands/advisor.js` (ext=1, int=0) -> `./src/commands/advisor.ts`
- `./commands/logout/index.js` (ext=1, int=0) -> `./src/commands/logout/index.ts`
- `./commands/logout/logout.js` (ext=1, int=0) -> `./src/commands/logout/logout.tsx`
- `./emptyUsage.js` (ext=1, int=0) -> `./src/emptyUsage.ts`
- `./ultrareviewQuota.js` (ext=1, int=0) -> `./src/ultrareviewQuota.ts`
- `./firstTokenDate.js` (ext=1, int=0) -> `./src/firstTokenDate.ts`
- `./adminRequests.js` (ext=1, int=0) -> `./src/adminRequests.ts`
- `./metricsOptOut.js` (ext=1, int=0) -> `./src/metricsOptOut.ts`
- `./bootstrap.js` (ext=1, int=0) -> `./src/bootstrap.ts`
- `./headlessProfiler.js` (ext=1, int=0) -> `./src/headlessProfiler.ts`
- `./queryProfiler.js` (ext=1, int=0) -> `./src/queryProfiler.ts`
- `./claudeLegacyRuntime.js` (ext=1, int=0) -> `./src/claudeLegacyRuntime.ts`
- `./model/check1mAccess.js` (ext=1, int=0) -> `./src/model/check1mAccess.ts`
- `./caCerts.js` (ext=1, int=0) -> `./src/caCerts.ts`
- `./openai/convertTools.js` (ext=1, int=0) -> `./src/openai/convertTools.ts`
- `./gemini/types.js` (ext=1, int=0) -> `./src/gemini/types.ts`
- `./gemini/convertTools.js` (ext=1, int=0) -> `./src/gemini/convertTools.ts`
- `./grok/client.js` (ext=1, int=0) -> `./src/grok/client.ts`
- `./model/aliases.js` (ext=1, int=0) -> `./src/model/aliases.ts`
- `./model/antModels.js` (ext=1, int=0) -> `./src/model/antModels.ts`
