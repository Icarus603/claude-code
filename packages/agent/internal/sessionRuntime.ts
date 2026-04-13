import { getAgentHostBindings } from '../host.js'

export function getSessionId(): string {
  return getAgentHostBindings().getSessionId?.() ?? 'unknown'
}

export function getSdkBetas(): string[] {
  return getAgentHostBindings().getSdkBetas?.() ?? []
}

export function getCurrentTurnTokenBudget(): number {
  return getAgentHostBindings().getCurrentTurnTokenBudget?.() ?? 0
}

export function getTurnOutputTokens(): number {
  return getAgentHostBindings().getTurnOutputTokens?.() ?? 0
}

export function incrementBudgetContinuationCount(): void {
  getAgentHostBindings().incrementBudgetContinuationCount?.()
}

export function getCwdState(): string {
  return (
    getAgentHostBindings().getCwdState?.() ??
    getAgentHostBindings().getOriginalCwd?.() ??
    process.cwd()
  )
}

export function setCwdState(cwd: string): void {
  getAgentHostBindings().setCwdState?.(cwd)
}

export function getOriginalCwd(): string {
  return getAgentHostBindings().getOriginalCwd?.() ?? process.cwd()
}

export function isSessionPersistenceDisabled(): boolean {
  return getAgentHostBindings().isSessionPersistenceDisabled?.() ?? false
}
