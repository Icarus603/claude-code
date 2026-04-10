import { createHash } from 'crypto'
import { readFile } from 'fs/promises'

async function sha256(path: string): Promise<string> {
  const content = await readFile(path)
  return createHash('sha256').update(content).digest('hex')
}

async function main(): Promise<void> {
  const baseline = await readFile('docs/runtime-baseline.md', 'utf8')
  const blockMatch = baseline.match(
    /## Entrypoint Hash Snapshot\s+```text([\s\S]*?)```/,
  )

  if (!blockMatch) {
    throw new Error('runtime baseline is missing the entrypoint hash snapshot block')
  }

  const expected = blockMatch[1]
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [hash, ...rest] = line.split(/\s+/)
      return { hash, path: rest.join(' ') }
    })

  for (const entry of expected) {
    const current = await sha256(entry.path)
    if (current !== entry.hash) {
      throw new Error(
        `Entrypoint compatibility hash mismatch for ${entry.path}: current=${current}, expected=${entry.hash}`,
      )
    }
  }

  console.log('session format compatibility verification passed')
}

await main()
