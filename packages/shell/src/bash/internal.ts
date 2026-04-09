/**
 */


export function _logError(error: unknown): void {
  if (error instanceof Error && error.stack) {
    console.error(error.stack)
  } else {
    console.error(String(error))
  }
}

export function _logForDebugging(_msg: string): void {
}

export function _logEvent(
  _name: string,
  _data: Record<string, unknown>,
): void {
}


/**
 */
export function _jsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 */
export function _memoizeWithLRU<T extends (...args: any[]) => any>(
  fn: T,
  keyFn: (...args: Parameters<T>) => string,
  maxSize: number,
): T & { cache: Map<string, ReturnType<T>> } {
  const cache = new Map<string, ReturnType<T>>()
  const wrapped = ((...args: Parameters<T>): ReturnType<T> => {
    const key = keyFn(...args)
    const cached = cache.get(key)
    if (cached !== undefined) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }
    const result = fn(...args)
    cache.set(key, result)
    if (cache.size > maxSize) {
      const firstKey = cache.keys().next().value
      if (firstKey !== undefined) cache.delete(firstKey)
    }
    return result
  }) as T & { cache: Map<string, ReturnType<T>> }
  wrapped.cache = cache
  return wrapped
}
