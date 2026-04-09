import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { StorageBackend, StorageReadResult, StorageWriteData } from '../contracts.js'

function toBuffer(data: StorageWriteData): Buffer {
  return typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)
}

async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
}

export class LocalFileStorageBackend implements StorageBackend {
  async read(path: string): Promise<StorageReadResult> {
    try {
      const content = await readFile(path)
      return content
    } catch {
      return null
    }
  }

  async write(path: string, data: StorageWriteData): Promise<void> {
    await ensureParentDir(path)
    await writeFile(path, toBuffer(data))
  }

  async append(path: string, data: StorageWriteData): Promise<void> {
    await ensureParentDir(path)
    const existing = await this.read(path)
    const next = Buffer.concat([
      existing instanceof Uint8Array ? Buffer.from(existing) : Buffer.from(existing ?? ''),
      toBuffer(data),
    ])
    await writeFile(path, next)
  }

  async delete(path: string): Promise<void> {
    await rm(path, { force: true, recursive: true })
  }

  async list(path: string): Promise<string[]> {
    try {
      const fileStat = await stat(path)
      if (fileStat.isFile()) {
        return [path]
      }
      const entries = await readdir(path)
      return entries.map(entry => join(path, entry))
    } catch {
      return []
    }
  }
}
