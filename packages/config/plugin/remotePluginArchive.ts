import { readdir, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

const MAX_PLUGIN_ARCHIVE_BYTES = 100 * 1024 * 1024

export async function resolveSessionPluginPath(
  pluginUrl: string,
  index: number,
  cacheDir: string,
  extract: (archivePath: string, destination: string) => Promise<void>,
): Promise<string> {
  if (!/^https?:\/\//i.test(pluginUrl)) return resolve(pluginUrl)
  const url = new URL(pluginUrl)
  if (url.protocol !== 'https:') {
    throw new Error('--plugin-url requires HTTPS')
  }
  const response = await fetch(url, { redirect: 'follow' })
  if (response.url && new URL(response.url).protocol !== 'https:') {
    throw new Error('Plugin download redirected to a non-HTTPS URL')
  }
  if (!response.ok) {
    throw new Error(`Plugin download failed: HTTP ${response.status}`)
  }
  const declaredSize = Number(response.headers.get('content-length') ?? 0)
  if (declaredSize > MAX_PLUGIN_ARCHIVE_BYTES) {
    throw new Error('Plugin archive exceeds 100 MB limit')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_PLUGIN_ARCHIVE_BYTES) {
    throw new Error('Plugin archive exceeds 100 MB limit')
  }

  const archivePath = join(cacheDir, `remote-${index}.zip`)
  let pluginPath = join(cacheDir, `remote-${index}`)
  await writeFile(archivePath, bytes)
  await extract(archivePath, pluginPath)
  const entries = await readdir(pluginPath, { withFileTypes: true })
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    pluginPath = join(pluginPath, entries[0].name)
  }
  return pluginPath
}
