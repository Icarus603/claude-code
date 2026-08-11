import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

async function mockCcb(loggedIn: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ccb-analyze-auth-'))
  tempDirs.push(dir)
  const binary = join(dir, 'ccb')
  await writeFile(
    binary,
    `#!/usr/bin/env bash\nprintf '{"loggedIn":${loggedIn}}\\n'\n${loggedIn ? 'exit 0' : 'exit 1'}\n`,
  )
  await chmod(binary, 0o755)
  return binary
}

describe('bun-demincer analyzer auth preflight', () => {
  test('accepts a logged-in non-interactive ccb', async () => {
    const proc = Bun.spawn(
      [resolve('bun-demincer/analyze.sh'), '--check-auth'],
      {
        env: { ...process.env, CCB_BIN: await mockCcb(true) },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    expect(await proc.exited).toBe(0)
  })

  test('fails visibly when ccb is logged out', async () => {
    const proc = Bun.spawn(
      [resolve('bun-demincer/analyze.sh'), '--check-auth'],
      {
        env: { ...process.env, CCB_BIN: await mockCcb(false) },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const stderr = await new Response(proc.stderr).text()
    expect(await proc.exited).toBe(1)
    expect(stderr).toContain('ccb is not logged in')
    expect(stderr).toContain('ccb auth login')
  })
})
