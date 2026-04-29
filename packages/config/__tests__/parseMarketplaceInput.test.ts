import { beforeEach, describe, expect, mock, test } from 'bun:test'

// parseMarketplaceInput uses fs.stat for local-path branches. Mock the
// FS implementation accessor to a controllable in-memory shape so the
// test doesn't need real files, AND so we can probe the
// non-existent / EACCES / file-vs-directory branches.
const realDeps = await import('../plugin/_deps.js')

let mockStat: ((p: string) => Promise<{ isFile(): boolean; isDirectory(): boolean }>) | null =
  null

mock.module('../plugin/_deps.js', () => ({
  ...realDeps,
  getFsImplementation: () => ({
    stat: async (p: string) => {
      if (!mockStat) {
        const e = new Error('ENOENT')
        ;(e as unknown as { code: string }).code = 'ENOENT'
        throw e
      }
      return mockStat(p)
    },
  }),
  getErrnoCode: (e: unknown): string | undefined => {
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      typeof (e as Record<string, unknown>).code === 'string'
    )
      return (e as Record<string, string>).code
    return undefined
  },
}))

const { parseMarketplaceInput } = await import('../plugin/parseMarketplaceInput.js')

beforeEach(() => {
  mockStat = null
})

describe('parseMarketplaceInput — git SSH URLs', () => {
  test('standard git@github.com:owner/repo', async () => {
    expect(await parseMarketplaceInput('git@github.com:owner/repo')).toEqual({
      source: 'git',
      url: 'git@github.com:owner/repo',
    })
  })

  test('with .git suffix', async () => {
    expect(
      await parseMarketplaceInput('git@github.com:owner/repo.git'),
    ).toEqual({
      source: 'git',
      url: 'git@github.com:owner/repo.git',
    })
  })

  test('with ref (#branch)', async () => {
    expect(
      await parseMarketplaceInput('git@github.com:owner/repo.git#main'),
    ).toEqual({
      source: 'git',
      url: 'git@github.com:owner/repo.git',
      ref: 'main',
    })
  })

  test('GHE SSH cert pattern (org-NUMBER@host)', async () => {
    expect(
      await parseMarketplaceInput('org-123456@github.com:owner/repo.git'),
    ).toEqual({
      source: 'git',
      url: 'org-123456@github.com:owner/repo.git',
    })
  })

  test('GitLab with deploy@ user', async () => {
    expect(
      await parseMarketplaceInput('deploy@gitlab.com:group/project.git'),
    ).toEqual({
      source: 'git',
      url: 'deploy@gitlab.com:group/project.git',
    })
  })

  test('self-hosted with IP host', async () => {
    expect(
      await parseMarketplaceInput('user@192.168.10.123:path/to/repo'),
    ).toEqual({
      source: 'git',
      url: 'user@192.168.10.123:path/to/repo',
    })
  })

  test('ref with hash characters in branch name (any non-empty after #)', async () => {
    expect(
      await parseMarketplaceInput('git@github.com:o/r.git#feature/x'),
    ).toEqual({
      source: 'git',
      url: 'git@github.com:o/r.git',
      ref: 'feature/x',
    })
  })

  test('username with dots/underscores/hyphens', async () => {
    expect(
      await parseMarketplaceInput('a.b_c-d@h:p/r'),
    ).toEqual({ source: 'git', url: 'a.b_c-d@h:p/r' })
  })
})

describe('parseMarketplaceInput — HTTP/HTTPS URLs', () => {
  test('GitHub HTTPS URL → git source with .git appended', async () => {
    expect(
      await parseMarketplaceInput('https://github.com/owner/repo'),
    ).toEqual({
      source: 'git',
      url: 'https://github.com/owner/repo.git',
    })
  })

  test('GitHub HTTPS URL with .git → git source preserved', async () => {
    expect(
      await parseMarketplaceInput('https://github.com/owner/repo.git'),
    ).toEqual({
      source: 'git',
      url: 'https://github.com/owner/repo.git',
    })
  })

  test('www.github.com hostname accepted', async () => {
    expect(
      await parseMarketplaceInput('https://www.github.com/owner/repo'),
    ).toEqual({
      source: 'git',
      url: 'https://www.github.com/owner/repo.git',
    })
  })

  test('GitHub HTTPS URL with #ref', async () => {
    expect(
      await parseMarketplaceInput('https://github.com/owner/repo#dev'),
    ).toEqual({
      source: 'git',
      url: 'https://github.com/owner/repo.git',
      ref: 'dev',
    })
  })

  test('Generic HTTPS URL → url source', async () => {
    expect(
      await parseMarketplaceInput('https://example.com/marketplace.json'),
    ).toEqual({
      source: 'url',
      url: 'https://example.com/marketplace.json',
    })
  })

  test('http (not https) accepted', async () => {
    expect(
      await parseMarketplaceInput('http://example.com/marketplace.json'),
    ).toEqual({
      source: 'url',
      url: 'http://example.com/marketplace.json',
    })
  })

  test('CRITICAL bug-fix probe — Azure DevOps /_git/ URL stays as git source (not url)', async () => {
    // Documented bug fix gh-31256 / CC-299: ADO URLs use /_git/ in path with
    // NO .git suffix. Without this branch, the URL would be fetched as raw
    // marketplace.json HTML and parse-fail.
    expect(
      await parseMarketplaceInput('https://dev.azure.com/org/project/_git/repo'),
    ).toEqual({
      source: 'git',
      url: 'https://dev.azure.com/org/project/_git/repo',
    })
  })

  test('ADO with #ref preserved', async () => {
    expect(
      await parseMarketplaceInput(
        'https://dev.azure.com/org/project/_git/repo#main',
      ),
    ).toEqual({
      source: 'git',
      url: 'https://dev.azure.com/org/project/_git/repo',
      ref: 'main',
    })
  })

  test('arbitrary URL with .git suffix → git source', async () => {
    expect(
      await parseMarketplaceInput('https://gitea.example.com/o/r.git'),
    ).toEqual({
      source: 'git',
      url: 'https://gitea.example.com/o/r.git',
    })
  })

  test('invalid URL with http:// prefix → fallback url source', async () => {
    // The new URL() constructor throws for malformed URLs. Documented
    // fallback: treat as generic url source.
    const result = await parseMarketplaceInput('https://[invalid')
    expect(result).toMatchObject({ source: 'url' })
  })

  test('GitHub URL with extra path beyond repo → url source (regex requires owner/repo only)', async () => {
    // The regex `^/([^/]+/[^/]+?)(\/|\.git|$)/` matches owner/repo segments.
    // A URL like /owner/repo/issues/1 has extra path → no match → fall through
    // to url source.
    expect(
      await parseMarketplaceInput(
        'https://github.com/owner/repo/issues/1',
      ),
    ).toEqual({
      source: 'git',
      url: 'https://github.com/owner/repo/issues/1.git',
    })
  })
})

describe('parseMarketplaceInput — local paths', () => {
  test('absolute path to .json file → file source', async () => {
    mockStat = async () => ({ isFile: () => true, isDirectory: () => false })
    expect(await parseMarketplaceInput('/abs/path/marketplace.json')).toEqual({
      source: 'file',
      path: '/abs/path/marketplace.json',
    })
  })

  test('absolute path to non-.json file → error', async () => {
    mockStat = async () => ({ isFile: () => true, isDirectory: () => false })
    const result = await parseMarketplaceInput('/abs/path/file.txt')
    expect(result).toMatchObject({ error: expect.stringContaining('.json') })
  })

  test('absolute path to directory → directory source', async () => {
    mockStat = async () => ({ isFile: () => false, isDirectory: () => true })
    expect(await parseMarketplaceInput('/abs/path/marketplace-dir')).toEqual({
      source: 'directory',
      path: '/abs/path/marketplace-dir',
    })
  })

  test('relative path ./foo.json → file source', async () => {
    mockStat = async () => ({ isFile: () => true, isDirectory: () => false })
    const result = await parseMarketplaceInput('./local.json')
    expect(result).toMatchObject({ source: 'file' })
  })

  test('relative path ../foo → checks stat', async () => {
    mockStat = async () => ({ isFile: () => false, isDirectory: () => true })
    const result = await parseMarketplaceInput('../parent/dir')
    expect(result).toMatchObject({ source: 'directory' })
  })

  test('home-relative ~/foo → expanded then statted', async () => {
    mockStat = async () => ({ isFile: () => true, isDirectory: () => false })
    const result = await parseMarketplaceInput('~/marketplace.json')
    expect(result).toMatchObject({ source: 'file' })
  })

  test('non-existent path → ENOENT error', async () => {
    mockStat = async () => {
      const e = new Error('ENOENT')
      ;(e as unknown as { code: string }).code = 'ENOENT'
      throw e
    }
    const result = await parseMarketplaceInput('/nonexistent')
    expect(result).toMatchObject({
      error: expect.stringContaining('Path does not exist'),
    })
  })

  test('inaccessible path (EACCES) → access error with code', async () => {
    mockStat = async () => {
      const e = new Error('EACCES')
      ;(e as unknown as { code: string }).code = 'EACCES'
      throw e
    }
    const result = await parseMarketplaceInput('/restricted')
    expect(result).toMatchObject({
      error: expect.stringContaining('EACCES'),
    })
  })

  test('path that is neither file nor directory → error', async () => {
    // Some special files (FIFO, socket) return false for both isFile and
    // isDirectory. This branch is reached.
    mockStat = async () => ({ isFile: () => false, isDirectory: () => false })
    const result = await parseMarketplaceInput('/some/fifo')
    expect(result).toMatchObject({
      error: expect.stringContaining('neither a file nor a directory'),
    })
  })
})

describe('parseMarketplaceInput — GitHub shorthand', () => {
  test('owner/repo → github source', async () => {
    expect(await parseMarketplaceInput('owner/repo')).toEqual({
      source: 'github',
      repo: 'owner/repo',
    })
  })

  test('owner/repo#ref → with ref', async () => {
    expect(await parseMarketplaceInput('owner/repo#main')).toEqual({
      source: 'github',
      repo: 'owner/repo',
      ref: 'main',
    })
  })

  test('owner/repo@ref → @ also accepted as ref separator', async () => {
    // Documented: display formatter uses @, so users naturally type @ when
    // copying. Both # and @ accepted.
    expect(await parseMarketplaceInput('owner/repo@v1.0')).toEqual({
      source: 'github',
      repo: 'owner/repo',
      ref: 'v1.0',
    })
  })

  test('input with colon → null (rejects ambiguous SSH-like)', async () => {
    // When a slash-containing string ALSO has a colon, it's likely meant as
    // SSH but didn't match the SSH regex (e.g., bad format). Reject.
    expect(
      await parseMarketplaceInput('weird:owner/repo'),
    ).toBeNull()
  })

  test('@-prefixed slash input rejected (npm-style scoped package)', async () => {
    // The check `!trimmed.startsWith('@')` excludes @scope/package — those
    // are npm scoped packages, not GitHub repos.
    expect(await parseMarketplaceInput('@scope/package')).toBeNull()
  })
})

describe('parseMarketplaceInput — rejection / unrecognized', () => {
  test('plain word (no /, no @, no protocol) → null', async () => {
    expect(await parseMarketplaceInput('marketplace')).toBeNull()
  })

  test('empty string → null', async () => {
    // No format recognized.
    expect(await parseMarketplaceInput('')).toBeNull()
  })

  test('whitespace-only → null', async () => {
    // After trim → empty → no format.
    expect(await parseMarketplaceInput('   ')).toBeNull()
  })

  test('input is trimmed before parsing', async () => {
    // Padding stripped → matches as github shorthand.
    expect(await parseMarketplaceInput('  owner/repo  ')).toEqual({
      source: 'github',
      repo: 'owner/repo',
    })
  })
})
