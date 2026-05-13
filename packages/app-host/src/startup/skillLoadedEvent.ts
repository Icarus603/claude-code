import { getSkillToolCommands } from '@claude-code/command-runtime/runtime'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '@claude-code/local-observability'
import {
  computeSkillsBudgetStats,
  getCharBudget,
} from '@claude-code/tool-registry/tools/SkillTool/prompt.js'

/**
 * Logs a tengu_skill_loaded event for each skill available at session startup.
 * This enables analytics on which skills are available across sessions.
 */
export async function logSkillsLoaded(
  cwd: string,
  contextWindowTokens: number,
): Promise<void> {
  const skills = await getSkillToolCommands(cwd)
  const skillBudget = getCharBudget(contextWindowTokens)

  for (const skill of skills) {
    if (skill.type !== 'prompt') continue

    logEvent('tengu_skill_loaded', {
      // _PROTO_skill_name routes to the privileged skill_name BQ column.
      // Unredacted names don't go in additional_metadata.
      _PROTO_skill_name:
        skill.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      skill_source:
        skill.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      skill_loaded_from:
        skill.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      skill_budget: skillBudget,
      ...(skill.kind && {
        skill_kind:
          skill.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    })
  }

  // Port of ant v2.1.131 Ws7+pSK (4142.js / 5025.js): if the budget had
  // to truncate or drop skill descriptions, emit telemetry so operators
  // can spot when users start hitting the cap. The user-visible
  // notification triggers via the useSkillsBudgetNotification hook
  // (`packages/repl/src/diagnostics/skillsBudgetWarning.ts`).
  try {
    const stats = computeSkillsBudgetStats(skills, contextWindowTokens)
    if (
      stats.budgetMode !== 'fits' ||
      stats.cappedSkills.length > 0 ||
      stats.budgetTruncatedSkills.length > 0
    ) {
      logEvent('tengu_skill_budget_truncated', {
        budget_mode:
          stats.budgetMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        capped_count: stats.cappedSkills.length,
        truncated_count: stats.budgetTruncatedSkills.length,
        skill_total: skills.length,
      })
    }
  } catch {
    // budget computation must not block startup
  }
}
