/**
 * Marketplace source schema — stub for settings backward compatibility.
 *
 * The Plugins/Marketplace feature has been removed (V7 §19.8). This stub
 * preserves settings-file backward compatibility: existing config files
 * containing `marketplaceSource` entries are accepted without error.
 *
 * V7 §8.6 — config owns this schema; moved from @cc-app to avoid the
 * indirect root-src dependency.
 */
import { z } from 'zod/v4'
import { lazySchema } from '../../internal/lazySchema.js'

/**
 * Permissive marketplace source schema.
 *
 * Accepts any object with a `source: string` discriminant. The feature is
 * removed so no further validation is needed — the passthrough ensures
 * existing settings files are accepted without raising validation errors.
 */
export const MarketplaceSourceSchema = lazySchema(() =>
  z.object({ source: z.string() }).passthrough(),
)
