/**
 *
 *
 *
 */


export type CommandPrefixResult = {
  commandPrefix: string | null
}

export type CommandSubcommandPrefixResult = CommandPrefixResult & {
  subcommandPrefixes: Map<string, CommandPrefixResult>
}

export type PrefixExtractorConfig = {
  toolName: string
  policySpec: string
  eventName: string
  querySource: string
  preCheck?: (command: string) => CommandPrefixResult | null
}


function createLRUCache<K, V>(maxSize: number) {
  const cache = new Map<K, V>()
  return {
    get(key: K): V | undefined {
      const val = cache.get(key)
      if (val !== undefined) {
        cache.delete(key)
        cache.set(key, val)
      }
      return val
    },
    set(key: K, value: V): void {
      cache.delete(key)
      cache.set(key, value)
      if (cache.size > maxSize) {
        const first = cache.keys().next().value
        if (first !== undefined) cache.delete(first)
      }
    },
    delete(key: K): boolean {
      return cache.delete(key)
    },
    has(key: K): boolean {
      return cache.has(key)
    },
    get size(): number {
      return cache.size
    },
  }
}


/**
 */
export function createCommandPrefixExtractor(
  _config: PrefixExtractorConfig,
): ((
  command: string,
  abortSignal: AbortSignal,
  isNonInteractiveSession: boolean,
) => Promise<CommandPrefixResult | null>) & { cache: Map<string, unknown> } {
  const cache = new Map<string, unknown>()

  const fn = async (
    _command: string,
    _abortSignal?: AbortSignal,
    _isNonInteractiveSession?: boolean,
  ): Promise<CommandPrefixResult | null> => {
    return null
  }

  fn.cache = cache
  return fn
}

/**
 */
export function createSubcommandPrefixExtractor(
  _getPrefix: (
    command: string,
    abortSignal: AbortSignal,
    isNonInteractiveSession: boolean,
  ) => Promise<CommandPrefixResult | null>,
  _splitCommand: (command: string) => string[] | Promise<string[]>,
): ((
  command: string,
  abortSignal: AbortSignal,
  isNonInteractiveSession: boolean,
) => Promise<CommandSubcommandPrefixResult | null>) & { cache: Map<string, unknown> } {
  const cache = new Map<string, unknown>()

  const fn = async (
    _command: string,
    _abortSignal?: AbortSignal,
    _isNonInteractiveSession?: boolean,
  ): Promise<CommandSubcommandPrefixResult | null> => {
    return null
  }

  fn.cache = cache
  return fn
}
