import { toJSONSchema } from 'zod/v4'
import { SettingsSchema } from './types.js'

export function generateSettingsJSONSchema(): string {
  const jsonSchema = toJSONSchema(SettingsSchema(), { unrepresentable: 'any' })
  // V7 §11.4 — config no longer routes through src/utils/slowOperations.
  // The slowLogging wrapper around JSON.stringify is observability that
  // belongs to local-observability; for a one-shot schema dump it adds
  // nothing.
  return JSON.stringify(jsonSchema, null, 2)
}
