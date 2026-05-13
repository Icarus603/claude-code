/**
 * Constants for ShareOnboardingGuide — ported VERBATIM from ant v2.1.136
 * (3949.js xL8 / 3950.js Ug7).
 *
 *   TM_ → tool name
 *   AM_ → filename on disk
 *   OA6 → 64 KB cap
 */
export const SHARE_ONBOARDING_GUIDE_TOOL_NAME = 'ShareOnboardingGuide'
export const ONBOARDING_MD_FILENAME = 'ONBOARDING.md'
export const MAX_ONBOARDING_SIZE_BYTES = 65536

/**
 * Description sent to the model — copy-pasted from ant uL8 to preserve
 * the "default mode='check'" semantics the model relies on.
 */
export const SHARE_ONBOARDING_GUIDE_DESCRIPTION = `Upload the ${ONBOARDING_MD_FILENAME} in the current directory and return a share link teammates can open in Claude Code. Call this after the user has confirmed the final content.

When called with the default mode='check': if a local ${ONBOARDING_MD_FILENAME} is present, uploads it to the most-recently-updated org guide (or creates one if none exist) and returns a fresh link. If no local file is present, returns the existing link without uploading (status: has_existing).`
