/**
 * V7 §8.6 — bounded-int env-var validator.
 *
 * Moved from src/utils/envValidation.ts. Validates an env var against a
 * lower/upper bound and returns a typed result; bad values fall back to
 * the supplied default with a debug log.
 *
 * Host-provided dep: `logForDebugging` injected via the config package's
 * host bindings (set by `installConfigHostBindings`).
 */

import { tryGetConfigHostBindings } from '../host.js'

export type EnvVarValidationResult = {
  effective: number
  status: 'valid' | 'capped' | 'invalid'
  message?: string
}

export function validateBoundedIntEnvVar(
  name: string,
  value: string | undefined,
  defaultValue: number,
  upperLimit: number,
): EnvVarValidationResult {
  if (!value) return { effective: defaultValue, status: 'valid' }
  const parsed = parseInt(value, 10)
  if (isNaN(parsed) || parsed <= 0) {
    const result: EnvVarValidationResult = {
      effective: defaultValue,
      status: 'invalid',
      message: `Invalid value "${value}" (using default: ${defaultValue})`,
    }
    tryGetConfigHostBindings().logDebug?.(`${name} ${result.message}`)
    return result
  }
  if (parsed > upperLimit) {
    const result: EnvVarValidationResult = {
      effective: upperLimit,
      status: 'capped',
      message: `Capped from ${parsed} to ${upperLimit}`,
    }
    tryGetConfigHostBindings().logDebug?.(`${name} ${result.message}`)
    return result
  }
  return { effective: parsed, status: 'valid' }
}
