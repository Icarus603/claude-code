export interface FileStateCache {
  readonly max: number
  readonly maxSize: number
  dump(): unknown
  load(entries: unknown): void
}

type CloneableFileStateCache = FileStateCache

export function cloneFileStateCache(
  cache: CloneableFileStateCache,
): CloneableFileStateCache {
  const ctor = cache.constructor as new (
    maxEntries: number,
    maxSizeBytes: number,
  ) => CloneableFileStateCache
  const cloned = new ctor(cache.max, cache.maxSize)
  cloned.load(cache.dump())
  return cloned
}
