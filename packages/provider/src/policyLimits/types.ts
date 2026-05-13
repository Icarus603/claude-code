import { z } from 'zod/v4'
import { lazySchema } from '@claude-code/tool-registry/utils/lazySchema.js'

/**
 * Schema for the policy limits API response
 * Only blocked policies are included. If a policy key is absent, it's allowed.
 *
 * `compliance_taints` (ported from ant v2.1.132 `ei7` module 4049.js) is an
 * additive forward-compat field: backend can ship arbitrary tag strings that
 * client code can query via hasComplianceTaint / getComplianceTaints. ant's
 * v2.1.132 emitted this with no consumer; ccb mirrors the schema so that
 * when the server starts sending taints, ccb can read them without a client
 * roll. Empty array default means cached responses without the field decode
 * cleanly.
 */
export const PolicyLimitsResponseSchema = lazySchema(() =>
  z.object({
    restrictions: z.record(z.string(), z.object({ allowed: z.boolean() })),
    compliance_taints: z.array(z.string()).default([]),
  }),
)

export type PolicyLimitsResponse = z.infer<
  ReturnType<typeof PolicyLimitsResponseSchema>
>

/**
 * Result of fetching policy limits
 */
export type PolicyLimitsFetchResult = {
  success: boolean
  restrictions?: PolicyLimitsResponse['restrictions'] | null // null means 304 Not Modified (cache is valid)
  /**
   * Compliance taint strings from server. Empty array if backend omitted the
   * field. `null` (paired with 304) means "use cached value".
   */
  complianceTaints?: string[] | null
  etag?: string
  error?: string
  skipRetry?: boolean // If true, don't retry on failure (e.g., auth errors)
}
