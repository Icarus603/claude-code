/**
 * UI utilities for sandbox violations
 * Used for displaying sandbox-related information in the UI.
 */

export function removeSandboxViolationTags(text: string): string {
  return text.replace(/<sandbox_violations>[\s\S]*?<\/sandbox_violations>/g, '')
}
