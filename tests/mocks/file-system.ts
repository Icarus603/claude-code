import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function createTempDir(prefix = 'claude-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

export async function writeTempFile(
  dir: string,
  name: string,
  content: string,
): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, content, 'utf-8')
  return path
}
