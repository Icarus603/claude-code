const listeners = new Set<(directories: string[]) => void>()

export function subscribeAdditionalDirectories(
  listener: (directories: string[]) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyAdditionalDirectories(directories: string[]): void {
  for (const listener of listeners) listener([...directories])
}
