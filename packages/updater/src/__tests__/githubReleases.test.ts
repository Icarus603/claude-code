import { describe, expect, test } from 'bun:test'
import { parseTagFromReleaseLocation } from '../githubReleases.js'

// parseTagFromReleaseLocation extracts the tag from the `Location` header
// that github.com returns on a 302 from `/releases/latest`. This is the
// rate-limit-free path the auto-updater relies on (api.github.com's
// unauthenticated 60/h budget is shared per-IP and routinely exhausted,
// producing a 403 that silently disabled auto-update — the bug this
// function exists to fix). Lock the parsing so a regression can't
// re-break update resolution.
describe('parseTagFromReleaseLocation', () => {
  test('extracts tag from an absolute github.com redirect URL', () => {
    expect(
      parseTagFromReleaseLocation(
        'https://github.com/Icarus603/claude-code/releases/tag/v26.5.92',
      ),
    ).toBe('v26.5.92')
  })

  test('extracts tag from a relative redirect path', () => {
    expect(
      parseTagFromReleaseLocation(
        '/Icarus603/claude-code/releases/tag/v26.5.92',
      ),
    ).toBe('v26.5.92')
  })

  test('preserves the leading v (callers strip if needed)', () => {
    const tag = parseTagFromReleaseLocation(
      'https://github.com/o/r/releases/tag/v1.carus.000',
    )
    expect(tag).toBe('v1.carus.000')
  })

  test('strips a trailing query string', () => {
    expect(
      parseTagFromReleaseLocation(
        'https://github.com/o/r/releases/tag/v26.5.92?foo=bar',
      ),
    ).toBe('v26.5.92')
  })

  test('strips a trailing hash fragment', () => {
    expect(
      parseTagFromReleaseLocation(
        'https://github.com/o/r/releases/tag/v26.5.92#notes',
      ),
    ).toBe('v26.5.92')
  })

  test('decodes percent-encoded tag segments', () => {
    // A tag containing an encoded char (defensive — ccb tags are plain,
    // but GitHub percent-encodes unusual tag names in the Location).
    expect(
      parseTagFromReleaseLocation(
        'https://github.com/o/r/releases/tag/v26.5.92%2Bbuild',
      ),
    ).toBe('v26.5.92+build')
  })

  test('returns null when the URL is the releases index (no /tag/)', () => {
    // A repo with zero releases serves the index at 200 with no /tag/
    // segment — the redirect path treats this as "no release".
    expect(
      parseTagFromReleaseLocation('https://github.com/o/r/releases'),
    ).toBeNull()
  })

  test('returns null for an unrelated URL', () => {
    expect(
      parseTagFromReleaseLocation('https://example.com/not/a/release'),
    ).toBeNull()
  })

  test('returns null for an empty string', () => {
    expect(parseTagFromReleaseLocation('')).toBeNull()
  })

  test('returns null when the tag segment is empty', () => {
    expect(
      parseTagFromReleaseLocation('https://github.com/o/r/releases/tag/'),
    ).toBeNull()
  })
})
