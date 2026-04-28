import React, { useEffect, useState } from 'react'
import { Box, Dialog, Text } from '@anthropic/ink'
import {
  disconnectConnection,
  getConnections,
  type ConnectionRecord,
} from '@claude-code/provider/connections.js'
import { gracefulShutdownSync } from '@claude-code/app-host/bootstrap/gracefulShutdown.js'
import { Select } from './CustomSelect/select.js'

type Props = {
  onDone: (message: string) => void
}

type Phase =
  | { kind: 'select'; connections: ConnectionRecord[] }
  | { kind: 'working'; name: string }
  | { kind: 'empty' }

function describe(conn: ConnectionRecord): React.ReactNode {
  const auth =
    conn.auth.type === 'oauth' ? `OAuth · ${conn.auth.source}` : 'API key'
  return (
    <Text>
      <Text bold>{conn.name}</Text>
      <Text dimColor>
        {' '}
        — {conn.protocol} · {auth}
      </Text>
    </Text>
  )
}

/**
 * Disconnect a connection and decide whether to keep the REPL alive.
 *
 * If this disconnect leaves zero connections, the user is fully logged
 * out — there is no provider left to serve any future query, so staying
 * in the REPL would be a deceptive empty shell. Trigger graceful
 * shutdown so the next session starts clean.
 *
 * `gracefulShutdownSync` schedules the exit asynchronously, so the
 * caller's `onDone(message)` still fires (briefly) before the process
 * tears down — the user sees "Logged out of X" then a clean exit.
 */
async function performDisconnect(conn: ConnectionRecord): Promise<string> {
  await disconnectConnection(conn.id)
  if (getConnections().length === 0) {
    // No providers left — REPL has nothing to do. Schedule exit; the
    // returned message will still render briefly before shutdown finishes.
    gracefulShutdownSync(0, 'other')
  }
  return `Logged out of ${conn.name}`
}

export function LogoutPicker({ onDone }: Props): React.ReactNode {
  const initialConnections = getConnections()
  const [phase, setPhase] = useState<Phase>(() => {
    if (initialConnections.length === 0) return { kind: 'empty' }
    return { kind: 'select', connections: initialConnections }
  })

  // Single-connection short-circuit: skip the picker entirely.
  useEffect(() => {
    if (phase.kind !== 'select' || phase.connections.length !== 1) return
    const only = phase.connections[0]!
    setPhase({ kind: 'working', name: only.name })
    void performDisconnect(only).then(onDone, err => {
      onDone(
        `Logout failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  }, [phase, onDone])

  // Auto-close when there is nothing to log out of.
  useEffect(() => {
    if (phase.kind !== 'empty') return
    onDone('No active connections — already logged out.')
  }, [phase, onDone])

  if (phase.kind === 'empty') return null

  if (phase.kind === 'working') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text>Logging out of {phase.name}…</Text>
      </Box>
    )
  }

  // Multi-connection picker — disconnect-only, no add-new entry.
  return (
    <Dialog
      title="Logout"
      onCancel={() => onDone('Logout cancelled')}
      color="permission"
      inputGuide={() => <Text>Esc cancel</Text>}
    >
      <Box flexDirection="column" gap={1}>
        <Text>Select a connection to log out of:</Text>
        <Select
          options={phase.connections.map(c => ({
            label: describe(c),
            value: c.id,
          }))}
          onChange={async value => {
            const target = phase.connections.find(c => c.id === value)
            if (!target) {
              onDone('Logout cancelled')
              return
            }
            setPhase({ kind: 'working', name: target.name })
            try {
              const msg = await performDisconnect(target)
              onDone(msg)
            } catch (err) {
              onDone(
                `Logout failed: ${err instanceof Error ? err.message : String(err)}`,
              )
            }
          }}
        />
      </Box>
    </Dialog>
  )
}
