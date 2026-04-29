import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { homedir } from 'os'

// Some helpers (formatDirectoryList, getGlobBaseDirectory, isDangerousRemovalPath)
// are pure but the file imports cross-package deps that hit real fs/sandbox
// state. Mock those at the boundary so the pure helpers stay testable.
const realFsOps = await import('@claude-code/storage/fsOperations.js')
const realSandbox = await import('@claude-code/shell/sandbox.js')
mock.module('@claude-code/storage/fsOperations.js', () => ({
  ...realFsOps,
}))
mock.module('@claude-code/shell/sandbox.js', () => ({
  ...realSandbox,
  // Default: sandbox disabled so isPathInSandboxWriteAllowlist returns false.
  SandboxManager: {
    ...realSandbox.SandboxManager,
    isSandboxingEnabled: () => false,
  },
}))

const {
  formatDirectoryList,
  getGlobBaseDirectory,
  isDangerousRemovalPath,
  isPathInSandboxWriteAllowlist,
} = await import('../pathValidation.js')

const HOME = homedir()

describe('formatDirectoryList', () => {
  test('lists all directories when count <= 5', () => {
    expect(formatDirectoryList(['/a', '/b', '/c'])).toBe(`'/a', '/b', '/c'`)
  })
  test('truncates with "and N more" when over the cap', () => {
    expect(
      formatDirectoryList(['/a', '/b', '/c', '/d', '/e', '/f', '/g']),
    ).toBe(`'/a', '/b', '/c', '/d', '/e', and 2 more`)
  })
  test('exactly-5 lists all (no "and 0 more")', () => {
    expect(formatDirectoryList(['/a', '/b', '/c', '/d', '/e'])).toBe(
      `'/a', '/b', '/c', '/d', '/e'`,
    )
  })
  test('empty list produces empty string', () => {
    expect(formatDirectoryList([])).toBe('')
  })
  test('single directory', () => {
    expect(formatDirectoryList(['/only'])).toBe(`'/only'`)
  })
})

describe('getGlobBaseDirectory', () => {
  test('returns path unchanged when no glob chars', () => {
    expect(getGlobBaseDirectory('/foo/bar.txt')).toBe('/foo/bar.txt')
  })
  test('strips suffix at first glob char (*)', () => {
    expect(getGlobBaseDirectory('/foo/bar/*.txt')).toBe('/foo/bar')
  })
  test('strips suffix at first glob char (?)', () => {
    expect(getGlobBaseDirectory('/foo/bar?.txt')).toBe('/foo')
  })
  test('strips suffix at first glob char ([)', () => {
    expect(getGlobBaseDirectory('/foo/bar/[abc].txt')).toBe('/foo/bar')
  })
  test('strips suffix at first glob char ({)', () => {
    expect(getGlobBaseDirectory('/foo/bar/{a,b}.txt')).toBe('/foo/bar')
  })
  test('returns "." when no separator before glob char', () => {
    expect(getGlobBaseDirectory('*.txt')).toBe('.')
  })
  test('returns "/" for root-relative glob', () => {
    expect(getGlobBaseDirectory('/*.txt')).toBe('/')
  })
})

describe('isDangerousRemovalPath', () => {
  test('bare "*" is dangerous', () => {
    expect(isDangerousRemovalPath('*')).toBe(true)
  })
  test('"<path>/*" is dangerous (would remove all children)', () => {
    expect(isDangerousRemovalPath('/home/user/*')).toBe(true)
  })
  test('"/" is dangerous (root)', () => {
    expect(isDangerousRemovalPath('/')).toBe(true)
  })
  test('home directory itself is dangerous', () => {
    expect(isDangerousRemovalPath(HOME)).toBe(true)
  })
  test('home directory with trailing slash is dangerous', () => {
    expect(isDangerousRemovalPath(`${HOME}/`)).toBe(true)
  })
  test('direct child of root /usr is dangerous', () => {
    expect(isDangerousRemovalPath('/usr')).toBe(true)
  })
  test('direct child of root /tmp is dangerous', () => {
    expect(isDangerousRemovalPath('/tmp')).toBe(true)
  })
  test('grandchild /usr/local is NOT dangerous', () => {
    expect(isDangerousRemovalPath('/usr/local')).toBe(false)
  })
  test('grandchild /tmp/some-file is NOT dangerous', () => {
    expect(isDangerousRemovalPath('/tmp/myfile.txt')).toBe(false)
  })
  test('home/subdir is NOT dangerous', () => {
    expect(isDangerousRemovalPath(`${HOME}/code/project`)).toBe(false)
  })
  test('Windows drive root C:\\ is dangerous', () => {
    expect(isDangerousRemovalPath('C:\\')).toBe(true)
  })
  test('Windows drive root C:/ is dangerous (forward slash form)', () => {
    expect(isDangerousRemovalPath('C:/')).toBe(true)
  })
  test('Windows drive direct child C:\\Windows is dangerous', () => {
    expect(isDangerousRemovalPath('C:\\Windows')).toBe(true)
  })
  test('Windows drive grandchild C:\\Users\\me is NOT dangerous', () => {
    expect(isDangerousRemovalPath('C:\\Users\\me')).toBe(false)
  })
  test('double-backslash collapses (security regression check)', () => {
    // PowerShell can produce C:\\Windows; collapse should still flag it.
    expect(isDangerousRemovalPath('C:\\\\Windows')).toBe(true)
  })
  test('relative path that is not glob is not flagged', () => {
    expect(isDangerousRemovalPath('foo.txt')).toBe(false)
  })
})

describe('isPathInSandboxWriteAllowlist (sandbox disabled)', () => {
  test('returns false when sandboxing is off (mocked)', () => {
    expect(isPathInSandboxWriteAllowlist('/anywhere')).toBe(false)
  })
})
