// Thin alias for src/utils/teammate. Canonical implementation stays in src/
// because it holds module-level process-lifetime state (dynamicTeamContext)
// that must not be duplicated across package boundaries. This file exists so
// packages/* consumers stay inside V7 §11.2.
// eslint-disable-next-line no-restricted-imports
export {
  clearDynamicTeamContext,
  getAgentId,
  getAgentName,
  getDynamicTeamContext,
  getParentSessionId,
  getTeamName,
  getTeammateColor,
  hasActiveInProcessTeammates,
  hasWorkingInProcessTeammates,
  isPlanModeRequired,
  isTeamLead,
  isTeammate,
  setDynamicTeamContext,
  waitForTeammatesToBecomeIdle,
} from 'src/utils/teammate.js'
