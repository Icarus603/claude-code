const RESERVED_DESKTOP_PANE_NAMES = new Set([
  'claude browser',
  'claude preview',
])

export function isReservedDesktopPaneMcpServer(name: string): boolean {
  return RESERVED_DESKTOP_PANE_NAMES.has(
    name.trim().toLowerCase().replace(/[-_\s]+/g, ' '),
  )
}

export function isReservedMcpServerName(name: string): boolean {
  return (
    normalizeNameForMCP(name) === 'claude-in-chrome' ||
    isReservedDesktopPaneMcpServer(name)
  )
}
import { normalizeNameForMCP } from './normalization.js'
