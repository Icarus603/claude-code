/**
 * Semver comparison utilities that use Bun.semver when available
 * and fall back to the npm `semver` package in Node.js environments.
 *
 * Bun.semver.order() is ~20x faster than npm semver comparisons.
 * The npm semver fallback always uses { loose: true }.
 */

let _npmSemver: typeof import('semver') | undefined

function getNpmSemver(): typeof import('semver') {
  if (!_npmSemver) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _npmSemver = require('semver') as typeof import('semver')
  }
  return _npmSemver
}

export function gt(a: string, b: string): boolean {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.order(a, b) === 1
  }
  return getNpmSemver().gt(a, b, { loose: true })
}

export function gte(a: string, b: string): boolean {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.order(a, b) >= 0
  }
  return getNpmSemver().gte(a, b, { loose: true })
}

/**
 * Compare two version strings using semver when both are valid semver,
 * else fall back to lexicographic comparison. Designed for ccb's
 * "1.carus.000" tag format — Bun.semver.order throws on non-semver,
 * so update.ts and the native installer go through this wrapper
 * instead of calling gt/gte directly.
 *
 * Returns true iff `latest` represents a NEWER version than `current`.
 * For monotonic numeric suffix tags ("1.carus.000" → "1.carus.001"),
 * lex compare gives the right answer.
 */
export function isVersionNewer(latest: string, current: string): boolean {
  if (typeof Bun !== 'undefined') {
    try {
      return Bun.semver.order(latest, current) === 1
    } catch {
      /* fall through */
    }
  } else {
    try {
      return getNpmSemver().gt(latest, current, { loose: true })
    } catch {
      /* fall through */
    }
  }
  return latest > current
}

export function lt(a: string, b: string): boolean {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.order(a, b) === -1
  }
  return getNpmSemver().lt(a, b, { loose: true })
}

export function lte(a: string, b: string): boolean {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.order(a, b) <= 0
  }
  return getNpmSemver().lte(a, b, { loose: true })
}

export function satisfies(version: string, range: string): boolean {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.satisfies(version, range)
  }
  return getNpmSemver().satisfies(version, range, { loose: true })
}

export function order(a: string, b: string): -1 | 0 | 1 {
  if (typeof Bun !== 'undefined') {
    return Bun.semver.order(a, b)
  }
  return getNpmSemver().compare(a, b, { loose: true })
}

/**
 * Best-effort parse → canonical `.version` string. Mirrors ant
 * `uX8.parse(v)?.version` (3480.js): returns the cleaned version
 * string (e.g. "1.2.3" / "1.2.3-rc.1") when the input is parseable,
 * `undefined` otherwise. Useful for sanitizing server-provided
 * version strings before they're used in comparisons / logs.
 */
export function parseVersion(value: string): string | undefined {
  if (!value) return undefined
  // Trim + strip leading `v` BEFORE the parse probe so that whitespace
  // and the npm-convention prefix don't trip the strict-semver path.
  // ant's `uX8.parse(v)?.version` does the same normalisation via the
  // underlying semver library before returning `.version`.
  const cleaned = value.trim().replace(/^v/, '')
  if (!cleaned) return undefined
  if (typeof Bun !== 'undefined') {
    try {
      // Bun.semver.order throws on unparseable input; use it as a
      // "is parseable?" probe. If it doesn't throw, the string is
      // at least semver-shaped enough for comparison.
      Bun.semver.order(cleaned, '0.0.0')
      return cleaned
    } catch {
      return undefined
    }
  }
  try {
    const parsed = getNpmSemver().parse(cleaned, { loose: true })
    return parsed ? parsed.version : undefined
  } catch {
    return undefined
  }
}
