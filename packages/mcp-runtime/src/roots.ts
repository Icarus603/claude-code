import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  getOriginalCwd,
  subscribeAdditionalDirectories,
} from '@claude-code/app-host/bootstrap/state.js'

const clients = new Set<Client>()

subscribeAdditionalDirectories(() => {
  for (const client of clients) {
    void client
      .notification({ method: 'notifications/roots/list_changed' })
      .catch(() => clients.delete(client))
  }
})

export function registerRootsClient(client: Client): void {
  clients.add(client)
}

export function listMcpRoots(): { uri: string }[] {
  return [getOriginalCwd(), ...getAdditionalDirectoriesForClaudeMd()]
    .filter((value, index, all) => all.indexOf(value) === index)
    .map(directory => ({ uri: `file://${directory}` }))
}
