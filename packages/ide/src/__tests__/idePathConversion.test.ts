import { describe, expect, test } from 'bun:test'
import { checkWSLDistroMatch } from '../idePathConversion.js'

describe('checkWSLDistroMatch — non-WSL paths', () => {
  test('returns true for plain Windows path (not a WSL UNC)', () => {
    expect(checkWSLDistroMatch('C:\\Users\\me\\project', 'Ubuntu')).toBe(true)
  })
  test('returns true for plain POSIX path', () => {
    expect(checkWSLDistroMatch('/home/me/project', 'Ubuntu')).toBe(true)
  })
  test('returns true for empty path', () => {
    expect(checkWSLDistroMatch('', 'Ubuntu')).toBe(true)
  })
  test('returns true for relative path', () => {
    expect(checkWSLDistroMatch('./relative', 'Ubuntu')).toBe(true)
  })
})

describe('checkWSLDistroMatch — \\\\wsl.localhost form', () => {
  test('returns true when distro names match', () => {
    expect(
      checkWSLDistroMatch('\\\\wsl.localhost\\Ubuntu\\home\\me', 'Ubuntu'),
    ).toBe(true)
  })
  test('returns false when distro names differ', () => {
    expect(
      checkWSLDistroMatch('\\\\wsl.localhost\\Debian\\home\\me', 'Ubuntu'),
    ).toBe(false)
  })
  test('match is case-sensitive (Ubuntu ≠ ubuntu)', () => {
    expect(
      checkWSLDistroMatch('\\\\wsl.localhost\\Ubuntu\\home\\me', 'ubuntu'),
    ).toBe(false)
  })
})

describe('checkWSLDistroMatch — \\\\wsl$ form (legacy)', () => {
  test('returns true when distro names match', () => {
    expect(checkWSLDistroMatch('\\\\wsl$\\Ubuntu\\home\\me', 'Ubuntu')).toBe(
      true,
    )
  })
  test('returns false when distro names differ', () => {
    expect(checkWSLDistroMatch('\\\\wsl$\\Debian\\home\\me', 'Ubuntu')).toBe(
      false,
    )
  })
  test('handles wsl$ at root (no trailing path)', () => {
    expect(checkWSLDistroMatch('\\\\wsl$\\Ubuntu', 'Ubuntu')).toBe(true)
  })
})

describe('checkWSLDistroMatch — partial / malformed', () => {
  test('partial UNC prefix is treated as non-WSL → true', () => {
    expect(checkWSLDistroMatch('\\\\wsl', 'Ubuntu')).toBe(true)
  })
  test('UNC with empty distro segment is treated as non-WSL → true', () => {
    // The regex requires [^\\]+ for the distro part — if it's empty (\\\\wsl$\\\\path),
    // the regex doesn't match and the function returns true (the "not a WSL UNC" branch).
    expect(checkWSLDistroMatch('\\\\wsl$\\\\path', 'Ubuntu')).toBe(true)
  })
})
