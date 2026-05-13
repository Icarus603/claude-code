/**
 * ShareOnboardingGuide tool — port of ant v2.1.136 (3950.js Il5).
 *
 * Surfaces a 4-mode action:
 *   - check (default): if local ONBOARDING.md exists, upload it to the
 *     most-recent org guide (or create); else return existing link.
 *   - update: upload to a specific short_code.
 *   - create: always create a fresh guide.
 *   - delete: remove a guide by short_code.
 *
 * Gated by `tengu_flint_harbor_share`. Requires Anthropic OAuth.
 *
 * isDestructive only when mode='delete' (matches ant isDestructive).
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import { z } from 'zod/v4'
import { getOriginalCwd } from '@claude-code/app-host/bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { getClaudeAIOAuthTokens } from '@claude-code/provider/authAlias.js'
import { isEssentialTrafficOnly } from '@claude-code/config/env/privacy-level'
import { isENOENT } from '@claude-code/local-observability/errorHelpers.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  createOnboardingGuide,
  deleteOnboardingGuide,
  getMostRecentOnboardingGuide,
  listOnboardingGuides,
  updateOnboardingGuide,
} from './api.js'
import {
  MAX_ONBOARDING_SIZE_BYTES,
  ONBOARDING_MD_FILENAME,
  SHARE_ONBOARDING_GUIDE_DESCRIPTION,
  SHARE_ONBOARDING_GUIDE_TOOL_NAME,
} from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    mode: z
      .enum(['check', 'update', 'create', 'delete'])
      .default('check')
      .describe(
        "'check' (default): if ONBOARDING.md is present locally, uploads it to the most-recent guide (creates one if none exist); otherwise reports the existing link without uploading. 'update': upload to a specific guide by short_code. 'create': always make a new link. 'delete': remove a guide.",
      ),
    short_code: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional()
      .describe(
        'Short code of a specific guide to target (returned by a previous call). Honored by check, update, and delete — skips the org-wide lookup and targets this guide directly.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.enum([
      'created',
      'updated',
      'deleted',
      'has_existing',
      'unavailable',
    ]),
    share_url: z.string().optional(),
    short_code: z.string().optional(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function unavailable(message: string): { data: Output } {
  return { data: { status: 'unavailable', message } }
}

function result(
  status: 'created' | 'updated' | 'has_existing',
  share_url: string,
  short_code: string,
  appendSendLine: boolean,
): { data: Output } {
  const tail = appendSendLine
    ? `\n\nClose with: "Here's your onboarding guide: ${share_url}" followed by the send-to-teammates line.`
    : ''
  return {
    data: {
      status,
      share_url,
      short_code,
      message: `Share link ${status}: ${share_url} (short_code: ${short_code})${tail}`,
    },
  }
}

export const ShareOnboardingGuideTool = buildTool({
  name: SHARE_ONBOARDING_GUIDE_TOOL_NAME,
  searchHint: 'upload ONBOARDING.md and get a team share link',
  maxResultSizeChars: 1000,
  async description() {
    return SHARE_ONBOARDING_GUIDE_DESCRIPTION
  },
  async prompt() {
    return SHARE_ONBOARDING_GUIDE_DESCRIPTION
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // Port of ant v2.1.136 qA6 (3948.js):
    //   1. essential-traffic mode (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
    //      or `DISABLE_TELEMETRY` or `DO_NOT_TRACK`) → false (uploading is
    //      non-essential).
    //   2. No accessToken on the stored OAuth tokens → false (sharing
    //      needs an authenticated Anthropic call).
    //   3. `tengu_flint_harbor_share` flag must be on.
    //
    // We wrap the token read in try/catch because in early-bootstrap and
    // test fixtures, the OAuth store accessor may throw before the
    // settings stack is wired. A throw must NOT crash the tool registry
    // — fail-closed instead.
    try {
      if (isEssentialTrafficOnly()) return false
      if (!getClaudeAIOAuthTokens()?.accessToken) return false
    } catch {
      return false
    }
    return getFeatureValue_CACHED_MAY_BE_STALE('tengu_flint_harbor_share', false)
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  isDestructive(input) {
    return input.mode === 'delete'
  },
  async validateInput() {
    return { result: true }
  },
  toAutoClassifierInput(input) {
    return `share onboarding guide (mode: ${input.mode ?? 'check'})`
  },
  userFacingName() {
    return 'ShareOnboardingGuide'
  },
  renderToolUseMessage(input) {
    if (input.mode && input.mode !== 'check') return input.mode
    return null
  },
  renderToolResultMessage() {
    return null
  },
  renderToolUseProgressMessage() {
    return null
  },
  renderToolUseErrorMessage() {
    return null
  },
  renderToolUseRejectedMessage() {
    return null
  },
  // ant Il5 ships no `checkPermissions` — the tool is OAuth-gated and
  // non-destructive (except `delete` which is marked via isDestructive).
  // The auto-allow path keeps the model-driven mode='check' workflow
  // frictionless. The runtime still consults isDestructive for the
  // `delete` mode to surface a confirmation in the UI.
  async checkPermissions(input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },
  async call(input) {
    const mode = input.mode ?? 'check'
    const shortCode = input.short_code

    // ──────────────────────── DELETE ────────────────────────
    if (mode === 'delete') {
      try {
        const target =
          shortCode ?? (await getMostRecentOnboardingGuide())?.short_code
        if (!target) {
          return unavailable('No guide found for this org to delete.')
        }
        await deleteOnboardingGuide(target)
        return {
          data: {
            status: 'deleted' as const,
            message: `Guide ${target} deleted.`,
          },
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return unavailable(`Delete didn't go through (${msg}).`)
      }
    }

    // Ant uses `q8()` (original cwd from session start), NOT `kQ()`
    // (current cwd). Pinning to original cwd means an in-session
    // `cd src/` doesn't break ONBOARDING.md discovery — the guide is
    // a project-level artefact, not a per-folder one.
    const localPath = join(getOriginalCwd(), ONBOARDING_MD_FILENAME)

    // ──────────────────────── CHECK ─────────────────────────
    if (mode === 'check') {
      try {
        const existing = shortCode
          ? (await listOnboardingGuides()).find(g => g.short_code === shortCode)
          : await getMostRecentOnboardingGuide()
        if (existing) {
          let size: number | null = null
          try {
            size = (await fs.stat(localPath)).size
          } catch (e) {
            if (!isENOENT(e)) throw e
          }
          if (size === null) {
            return {
              data: {
                status: 'has_existing' as const,
                share_url: existing.share_url,
                short_code: existing.short_code,
                message: `A guide already exists for this org at ${existing.share_url} (short_code: ${existing.short_code}). If this link is what the user needed, share it. If they want to create or update a guide, tell them to run /team-onboarding themselves (it scans local session data and cannot be invoked by the model).`,
              },
            }
          }
          if (size > MAX_ONBOARDING_SIZE_BYTES) {
            return unavailable(
              `${ONBOARDING_MD_FILENAME} is over ${MAX_ONBOARDING_SIZE_BYTES / 1024}KB. Trim it before sharing.`,
            )
          }
          const content = await fs.readFile(localPath, 'utf8')
          const updated = await updateOnboardingGuide(
            existing.short_code,
            content,
          )
          return result('updated', updated.share_url, updated.short_code, false)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return unavailable(
          `Upload didn't go through (${msg}). Fall back to the manual share copy.`,
        )
      }
    }

    // ──────────────── CREATE / UPDATE (no existing) ─────────
    let size: number
    try {
      size = (await fs.stat(localPath)).size
    } catch (e) {
      if (isENOENT(e)) {
        return unavailable(
          `${ONBOARDING_MD_FILENAME} not found in the current directory. Write the guide first.`,
        )
      }
      throw e
    }
    if (size > MAX_ONBOARDING_SIZE_BYTES) {
      return unavailable(
        `${ONBOARDING_MD_FILENAME} is over ${MAX_ONBOARDING_SIZE_BYTES / 1024}KB. Trim it before sharing.`,
      )
    }
    const content = await fs.readFile(localPath, 'utf8')
    try {
      if (mode === 'update') {
        const target =
          shortCode ?? (await getMostRecentOnboardingGuide())?.short_code
        if (target) {
          const updated = await updateOnboardingGuide(target, content)
          return result('updated', updated.share_url, updated.short_code, true)
        }
      }
      const created = await createOnboardingGuide(content)
      return result('created', created.share_url, created.short_code, false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return unavailable(
        `Upload didn't go through (${msg}). Fall back to the manual share copy.`,
      )
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: `[${output.status}] ${output.message}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
